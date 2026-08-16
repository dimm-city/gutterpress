/**
 * Galley editor — ONE Tiptap/ProseMirror editor over the whole book, whose
 * `view.dom` IS the fragmenter's flow root.
 *
 * How the editor and the pagination engine coexist (the load-bearing idea):
 * the fragmenter paginates by MOVING the flow root's element nodes into
 * per-run multicol strips and cloning shallow ancestor shells — but it
 * always moves the SAME element references. ProseMirror's view descriptors
 * track DOM *references*, not tree paths, so with its DOMObserver detached
 * around every fragmenter pass (`withFragmenter`) and ParseRule ignores for
 * every piece of viewer chrome, its document, caret mapping
 * (posAtCoords/coordsAtPos read live rects), and in-place patching all keep
 * working while the fragmenter re-arranges presentation around the nodes.
 * Spike B measured this shape: typing median 2.70ms, view survives
 * `Gutterpress.refresh()`; galley-mount.test.ts pins it end to end.
 *
 * Ownership rules that keep this honest:
 * - ProseMirror owns CONTENT nodes (everything the doc renders).
 * - The viewer owns CHROME (strips, runs, layers, sheets, spacers) — all of
 *   it `contenteditable=false` and parse-ignored, so it can never enter the
 *   document or the serialization.
 * - Every fragmenter operation happens inside `withFragmenter()` so
 *   ProseMirror ignores exactly the mutations the viewer makes, no more.
 */
import { Editor, InputRule } from "@tiptap/core";
import type { Node as PMNode, Slice } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import { EditorState, Plugin, NodeSelection } from "@tiptap/pm/state";

import { galleyExtensions, MarkerAtom, MarkerWrap, RawBlock } from "./extensions.ts";
import { buildGalleyDoc, serializeGalleyDoc, type GalleyToken } from "./markdown.ts";

export interface GalleyChapter {
  chapter: string;
  source: string;
  tokens: GalleyToken[];
}

/**
 * v7-compatible selection payload — the SPA bubble handler reads
 * `rects[0]`, `block`, and `formats.{strong,em,s,code}` and is deliberately
 * unchanged by the galley swap, so those exact keys are the contract.
 */
export interface SelectionPayload {
  collapsed: boolean;
  formats: { strong: boolean; em: boolean; s: boolean; code: boolean };
  rects: Array<{ top: number; left: number; width: number; height: number }>;
  /** Truthy when the selection sits inside editable content (bubble gate). */
  block: { chapter: string | null } | null;
  chapter: string | null;
}

export interface OpaqueEditPayload {
  chapter: string | null;
  pos: number;
  src: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface GalleyEditorOptions {
  /** The rendered book's chapters, exactly as `/__galley/book` returns them. */
  chapters: GalleyChapter[];
  /** Where the editor root is inserted (the old flow content is replaced). */
  container: HTMLElement;
  /** Render a markdown fragment through the REAL pipeline (opaque display). */
  fragmentHtml(markdown: string): Promise<string>;
  /** Tokenize markdown through the real pipeline (insertMarkdown). */
  parseTokens(markdown: string): Promise<GalleyToken[]>;
  /** A chapter's serialization changed. `expected` = the previous text;
   *  `seq` must be echoed in the ack (guards cross-frame acks). */
  onContentChanged(spec: { chapter: string; markdown: string; expected: string; seq: number }): void;
  onSelection(payload: SelectionPayload): void;
  onDirtyChanged(dirty: boolean): void;
  onOpaqueEdit(payload: OpaqueEditPayload): void;
  /** Debounce for pagination refresh after edits (ms). */
  refreshDelayMs?: number;
  /** Debounce for serialization + save emit (ms). */
  saveDelayMs?: number;
}

interface ViewerGlobal {
  mount(opts: {
    root: HTMLElement;
    layoutBracket?: (fn: () => unknown) => Promise<unknown> | unknown;
  }): Promise<unknown>;
  refresh?: () => void;
}

/** Typing `@section ` on an empty paragraph converts it into the marker. */
function markerWrapInputRules(): InputRule[] {
  return ["chapter", "spread", "page", "section"].map(
    (kind) =>
      new InputRule({
        find: new RegExp(`^@${kind}\\s$`),
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return;
          chain()
            .deleteRange(range)
            .insertContent({
              type: "markerWrap",
              attrs: { kind, src: `@${kind}` },
              content: [{ type: "paragraph" }],
            })
            .run();
        },
      }),
  );
}

/** Typing `@page-break ` / `@column-break ` inserts the break atom. */
function markerAtomInputRules(): InputRule[] {
  return ["page-break", "column-break"].map(
    (kind) =>
      new InputRule({
        find: new RegExp(`^@${kind}\\s$`),
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return;
          chain()
            .deleteRange(range)
            .insertContent({
              type: "markerAtom",
              attrs: {
                src: `@${kind}`,
                domAttrs: [
                  ["class", `gp-${kind}`],
                  ["aria-hidden", "true"],
                ],
              },
            })
            .run();
        },
      }),
  );
}

export interface GalleyEditor {
  editor: Editor;
  /** Resolves when the viewer has mounted over the editor's DOM; rejects on
   * mount failure so the caller can fall back instead of hanging layout. */
  ready: Promise<void>;
  applyFormat(format: "bold" | "italic" | "strike" | "code"): boolean;
  insertMarkdown(markdown: string): Promise<boolean>;
  setOpaqueSource(pos: number, src: string): boolean;
  saveNow(): void;
  /** Host verdict on a galleyContent proposal. `seq` must match the
   *  outstanding proposal; `reason` triages refusals (transient → retry,
   *  divergence → suspend until reload). */
  ackContent(chapter: string, ok: boolean, seq?: number, reason?: string): void;
  selectionState(): SelectionPayload;
  /**
   * Context-menu target resolution (protocol v8). Mirrors the v7
   * `getContextTargetAt` payload — same `kind` precedence (selection → image
   * → link → marker → block → none) and the same image/link/selection
   * side-channels — but resolved through the ProseMirror document instead of
   * `data-source-range`, which the galley's PM-rendered DOM does not carry.
   * `pos` addresses the node so the host can mutate it via `setImageAttrs` /
   * `setLink` rather than splicing source text (a source splice under a live
   * galley would be reverted by the doc's own next whole-file save).
   */
  targetAt(x: number, y: number): GalleyContextTarget | null;
  /** Rewrite an image node's src/alt and its authored brace attrs. */
  setImageAttrs(
    pos: number,
    changes: { src?: string; alt?: string; title?: string | null; attrsRaw?: string },
  ): boolean;
  /** Apply/replace the link mark over the current selection (or the link at
   *  `pos` when the selection is collapsed inside one). `href: null` unlinks. */
  setLink(spec: { pos?: number; href: string | null }): boolean;
  destroy(): void;
}

/** Context-menu target — the galley analogue of protocol v7's ContextTarget. */
export interface GalleyContextTarget {
  kind: "selection" | "image" | "link" | "marker" | "block" | "none";
  chapter: string | null;
  /** Document position of the addressed node (the block for `block`/`marker`,
   *  the image node for `image`, the link's inline anchor for `link`). */
  pos: number;
  /** Node type name — the galley's answer to v7's `blockTag`. */
  blockTag: string | null;
  /** Opaque/raw-block source, when the target is one. */
  src?: string;
  image?: { src: string; alt: string; title: string | null; attrsRaw: string };
  link?: { href: string; text: string };
  selection?: { text: string; chapter: string | null };
  rect: { top: number; left: number; width: number; height: number } | null;
}

export function createGalleyEditor(opts: GalleyEditorOptions): GalleyEditor {
  const refreshDelayMs = opts.refreshDelayMs ?? 150;
  const saveDelayMs = opts.saveDelayMs ?? 500;

  // ── shared state ──────────────────────────────────────────────────────────
  const srcMap = new WeakMap<PMNode, string>();
  /** chapter id → the text the file is believed to contain right now. */
  const lastText = new Map<string, string>();
  /** chapter id → chapterFile node identity at the last emit. */
  const lastEmitted = new Map<string, PMNode>();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let destroyed = false;
  /** True once the author has focused or edited — gates caret-relative commands. */
  let interacted = false;

  const setDirty = (v: boolean) => {
    if (dirty !== v) {
      dirty = v;
      opts.onDirtyChanged(v);
    }
  };

  // ── fragment-display cache for opaque blocks ──────────────────────────────
  const fragmentCache = new Map<string, string>();
  async function fragmentFor(src: string): Promise<string> {
    const hit = fragmentCache.get(src);
    if (hit !== undefined) return hit;
    const html = await opts.fragmentHtml(src);
    fragmentCache.set(src, html);
    return html;
  }

  // ── extensions: nodeViews + input rules layered onto the shared schema ────
  const RawBlockWithView = RawBlock.extend({
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement("div");
        dom.className = "gp-raw-block";
        dom.setAttribute("contenteditable", "false");
        let currentSrc = node.attrs.src as string;
        const render = (src: string) => {
          fragmentFor(src)
            .then((html) => {
              if (dom.isConnected || !html) dom.innerHTML = html;
            })
            .catch(() => {
              // Fragment route unavailable — degrade to the verbatim source
              // rather than a silent blank block.
              dom.textContent = src;
            });
        };
        render(currentSrc);
        const requestEdit = () => {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos == null) return;
          const r = dom.getBoundingClientRect();
          opts.onOpaqueEdit({
            chapter: chapterAtPos(editor.state.doc, pos),
            pos,
            src: currentSrc,
            rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          });
        };
        dom.addEventListener("dblclick", requestEdit);
        return {
          dom,
          update: (updated: PMNode) => {
            if (updated.type.name !== "rawBlock") return false;
            if (updated.attrs.src !== currentSrc) {
              currentSrc = updated.attrs.src as string;
              render(currentSrc);
            }
            return true;
          },
          ignoreMutation: () => true,
          stopEvent: (e: Event) => e.type === "dblclick",
        };
      };
    },
  });

  const MarkerWrapWithRules = MarkerWrap.extend({
    addInputRules() {
      return markerWrapInputRules();
    },
  });
  const MarkerAtomWithRules = MarkerAtom.extend({
    addInputRules() {
      return markerAtomInputRules();
    },
  });

  const extensions = galleyExtensions().map((ext) => {
    if (ext.name === "rawBlock") return RawBlockWithView;
    if (ext.name === "markerWrap") return MarkerWrapWithRules;
    if (ext.name === "markerAtom") return MarkerAtomWithRules;
    return ext;
  });

  // ── the editor ────────────────────────────────────────────────────────────
  const editor = new Editor({
    element: opts.container,
    extensions,
    content: "",
    autofocus: false,
    onFocus: () => {
      interacted = true;
    },
    onSelectionUpdate: () => emitSelection(),
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged) return;
      setDirty(true);
      scheduleRefresh();
      scheduleSave();
    },
  });

  const schema = editor.schema;

  // ── build the master doc from the server's chapters ───────────────────────
  const chapterNodes: PMNode[] = [];
  for (const ch of opts.chapters) {
    const built = buildGalleyDoc(schema, ch.tokens, ch.source, srcMap);
    const wrapper = schema.nodes.chapterFile!.create({ src: ch.chapter }, built.doc.content);
    chapterNodes.push(wrapper);
    lastText.set(ch.chapter, ch.source);
    lastEmitted.set(ch.chapter, wrapper);
  }
  const masterDoc = schema.topNodeType.create(null, Fragment.fromArray(chapterNodes));
  editor.view.updateState(
    EditorState.create({ doc: masterDoc, plugins: editor.state.plugins }),
  );

  // ── viewer choreography ───────────────────────────────────────────────────
  /**
   * Run a fragmenter operation with ProseMirror's DOMObserver detached: the
   * viewer re-arranges PM's OWN element nodes into strips/sheets, and PM
   * must never see those mutations or it would revert them. `flush()` first
   * drains genuine pending records; `stop()`/`start()` bracket the move so
   * everything in between is invisible. (domObserver is not public API, but
   * it is the sanctioned escape hatch this exact pattern is known for; the
   * mount-integration test pins the behavior.)
   */
  let fragmenterDepth = 0;
  async function withFragmenter(fn: () => Promise<unknown> | unknown): Promise<void> {
    const obs = (
      editor.view as unknown as {
        domObserver: { flush(): void; stop(): void; start(): void };
      }
    ).domObserver;
    // Re-entrant: this same function is handed to the viewer as its
    // `layoutBracket`, so a viewer pass may run while an outer bracket is
    // already open (mountViewer wraps `mount()`, which brackets internally
    // too). Only the outermost frame may stop/start the observer — an inner
    // start() would re-arm it mid-surgery.
    if (fragmenterDepth === 0) {
      obs.flush();
      obs.stop();
    }
    fragmenterDepth++;
    try {
      await fn();
    } finally {
      fragmenterDepth--;
      if (fragmenterDepth === 0) obs.start();
    }
  }

  function stampChromeUneditable() {
    for (const el of document.querySelectorAll(".gp-layer, .gp-sheet")) {
      (el as HTMLElement).setAttribute("contenteditable", "false");
    }
  }

  async function mountViewer(): Promise<void> {
    const g = (window as unknown as { Gutterpress?: ViewerGlobal }).Gutterpress;
    if (!g?.mount) throw new Error("galley: viewer global missing");
    // `layoutBracket` covers every LATER viewer-initiated pass too —
    // setSpread()/refresh() driven by the host's setViewMode land outside
    // any galley call path, and unbracketed they let PM's observer see the
    // fragmenter's moves and revert them (wiping pagination to 0 pages).
    await withFragmenter(() =>
      g.mount({ root: editor.view.dom as HTMLElement, layoutBracket: withFragmenter }),
    );
    stampChromeUneditable();
  }

  async function refreshViewer(): Promise<void> {
    const g = (window as unknown as { Gutterpress?: ViewerGlobal }).Gutterpress;
    if (!g?.refresh) return;
    await withFragmenter(() => g.refresh!());
    stampChromeUneditable();
    // Re-assert the DOM selection after the fragmenter moved nodes around —
    // the state's selection is authoritative and the text nodes survived.
    if (editor.view.hasFocus()) {
      editor.view.dispatch(editor.state.tr.setMeta("galley-selection-sync", true));
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (!destroyed) void refreshViewer();
    }, refreshDelayMs);
  }

  const onRelayout = () => stampChromeUneditable();
  window.addEventListener("gp:relayout", onRelayout);

  // ── serialization + save emit ─────────────────────────────────────────────
  function chapterAtPos(doc: PMNode, pos: number): string | null {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
    for (let d = $pos.depth; d >= 1; d--) {
      const n = $pos.node(d);
      if (n.type.name === "chapterFile") return n.attrs.src as string;
    }
    // Atom selections resolve at the doc level; check the child directly.
    const child = doc.childAfter(Math.max(0, Math.min(pos, doc.content.size)));
    return child.node?.type.name === "chapterFile" ? (child.node.attrs.src as string) : null;
  }

  /**
   * Emit save proposals. `lastText`/`lastEmitted` advance ONLY on a
   * positive ack (`ackContent`) — an optimistic advance would break the
   * expected-chain the moment a commit is refused, permanently stalling
   * the chapter (verified finding).
   *
   * Refusals are triaged by reason: TRANSIENT ones (a dirty source pane, a
   * render in flight — self-healing seconds later) schedule a retry with
   * the chain untouched; only genuine divergence (the file changed under
   * the editor: mismatch / chapter-changed / unsafe path) suspends the
   * chapter until the surface reloads. A suspended or in-flight chapter is
   * DIRTY — the flag must never claim clean while text hasn't reached disk
   * (Opus-verified regression).
   *
   * Every proposal carries a `seq` nonce and acks must echo it: after a
   * frame swap, a late ack from the retired frame's proposal must not
   * advance or poison the replacement frame's chain.
   */
  const pendingAck = new Map<string, { markdown: string; wrapper: PMNode; seq: number }>();
  const staleChapters = new Set<string>();
  let seqCounter = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const FATAL_ACK_REASONS = new Set(["mismatch", "chapter-changed", "unsafe-chapter-path"]);

  function hasUnsavedContent(): boolean {
    if (pendingAck.size > 0 || saveTimer !== null) return true;
    let unsaved = false;
    editor.state.doc.forEach((wrapper) => {
      if (wrapper.type.name !== "chapterFile") return;
      if (lastEmitted.get(wrapper.attrs.src as string) !== wrapper) unsaved = true;
    });
    return unsaved;
  }

  function flushSave(force = false) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const doc = editor.state.doc;
    doc.forEach((wrapper) => {
      if (wrapper.type.name !== "chapterFile") return;
      const chapter = wrapper.attrs.src as string;
      if (staleChapters.has(chapter)) return;
      const pending = pendingAck.get(chapter);
      // In flight: stay quiet unless forced (the pre-swap flush must push
      // keystrokes typed AFTER the outstanding proposal — the session's
      // per-chapter latest-wins queue supersedes the older one).
      if (pending && !force) return;
      if (lastEmitted.get(chapter) === wrapper) return; // untouched
      const chapterDoc = schema.topNodeType.create(null, wrapper.content);
      const markdown = serializeGalleyDoc(schema, chapterDoc, srcMap);
      const expected = lastText.get(chapter) ?? "";
      if (pending?.markdown === markdown) return; // already proposed
      if (markdown === expected) {
        lastEmitted.set(chapter, wrapper);
        return;
      }
      const seq = ++seqCounter;
      pendingAck.set(chapter, { markdown, wrapper, seq });
      opts.onContentChanged({ chapter, markdown, expected, seq });
    });
    if (!hasUnsavedContent() && staleChapters.size === 0) setDirty(false);
  }

  function ackContent(chapter: string, ok: boolean, seq?: number, reason?: string): void {
    const p = pendingAck.get(chapter);
    // Ignore acks that don't match the outstanding proposal — they belong
    // to a retired frame's lifecycle or a superseded emit.
    if (!p || (typeof seq === "number" && p.seq !== seq)) return;
    pendingAck.delete(chapter);
    if (ok) {
      lastText.set(chapter, p.markdown);
      lastEmitted.set(chapter, p.wrapper);
    } else if (reason && !FATAL_ACK_REASONS.has(reason)) {
      // Transient refusal — the chain is untouched; retry after a beat.
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!destroyed) flushSave();
        }, saveDelayMs * 2);
      }
    } else {
      staleChapters.add(chapter);
      setDirty(true);
    }
    // Changes typed while the proposal was in flight emit now.
    if (!destroyed) flushSave();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!destroyed) flushSave();
    }, saveDelayMs);
  }

  // ── selection reporting (bubble) ──────────────────────────────────────────
  function selectionState(): SelectionPayload {
    const { state, view } = editor;
    const sel = state.selection;
    const collapsed = sel.empty;
    const rects: SelectionPayload["rects"] = [];
    if (!collapsed) {
      try {
        const a = view.coordsAtPos(sel.from);
        const b = view.coordsAtPos(sel.to, -1);
        const sameLine = Math.abs(a.top - b.top) < 4;
        rects.push({
          top: a.top,
          left: sameLine ? Math.min(a.left, b.left) : a.left,
          width: sameLine ? Math.abs(b.left - a.left) : 1,
          height: a.bottom - a.top,
        });
      } catch {
        /* position outside the viewport during a relayout beat */
      }
    }
    const chapter = chapterAtPos(state.doc, sel.from);
    return {
      collapsed,
      formats: {
        strong: editor.isActive("bold"),
        em: editor.isActive("italic"),
        s: editor.isActive("strike"),
        code: editor.isActive("code"),
      },
      rects,
      // The bubble shows only for selections inside editable content — a
      // NodeSelection on an atom reports no block.
      block: !collapsed && sel instanceof NodeSelection === false ? { chapter } : null,
      chapter,
    };
  }

  function emitSelection() {
    opts.onSelection(selectionState());
  }

  // ── keyboard entry to opaque editing ──────────────────────────────────────
  const opaqueKeyPlugin = new Plugin({
    props: {
      handleKeyDown: (view, event) => {
        if (event.key !== "Enter") return false;
        const sel = view.state.selection;
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== "rawBlock") return false;
        const dom = view.nodeDOM(sel.from);
        const r = dom instanceof Element ? dom.getBoundingClientRect() : null;
        opts.onOpaqueEdit({
          chapter: chapterAtPos(view.state.doc, sel.from),
          pos: sel.from,
          src: sel.node.attrs.src as string,
          rect: r
            ? { top: r.top, left: r.left, width: r.width, height: r.height }
            : { top: 0, left: 0, width: 0, height: 0 },
        });
        return true;
      },
    },
  });
  editor.registerPlugin(opaqueKeyPlugin);

  // ── initial mount ─────────────────────────────────────────────────────────
  const ready = mountViewer();

  // ── public surface ────────────────────────────────────────────────────────
  return {
    editor,
    ready,

    applyFormat(format) {
      const chain = editor.chain().focus();
      const applied =
        format === "bold"
          ? chain.toggleBold().run()
          : format === "italic"
            ? chain.toggleItalic().run()
            : format === "strike"
              ? chain.toggleStrike().run()
              : chain.toggleCode().run();
      return applied;
    },

    async insertMarkdown(markdown) {
      // Without a real caret (the author never focused the page), inserting
      // would land at the very start of the book and auto-save into chapter
      // one — refuse instead; the host falls back to the source editor.
      if (!interacted && !editor.view.hasFocus()) return false;
      const tokens = await opts.parseTokens(markdown);
      const { doc } = buildGalleyDoc(schema, tokens, markdown, srcMap);
      if (!doc.childCount) return false;
      const { state } = editor;
      const slice: Slice = doc.slice(0, doc.content.size);
      const tr = state.tr.replaceSelection(slice);
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      return true;
    },

    setOpaqueSource(pos, src) {
      const node = editor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "rawBlock") return false;
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "src", src));
      return true;
    },

    saveNow() {
      flushSave(true);
    },

    ackContent,

    selectionState,

    targetAt(x, y) {
      const found = editor.view.posAtCoords({ left: x, top: y });
      if (!found) return null;
      const { doc } = editor.state;
      const $pos = doc.resolve(found.pos);
      const chapter = chapterAtPos(doc, found.pos);
      const rectOf = (pos: number) => {
        try {
          const dom = editor.view.nodeDOM(pos);
          const el =
            dom instanceof Element
              ? dom
              : dom && (dom as Node).parentElement
                ? (dom as Node).parentElement!
                : null;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, width: r.width, height: r.height };
        } catch {
          return null;
        }
      };

      // The point's own element decides image/link, exactly as the v7 DOM
      // walk did — a click lands on the <img>/<a> the author sees, and PM's
      // position may resolve to the enclosing text block.
      const pointEl = document.elementFromPoint(x, y);

      // 1. Selection wins (matches the v7 precedence the menu is built for).
      const sel = editor.state.selection;
      if (!sel.empty && !(sel instanceof NodeSelection)) {
        const text = doc.textBetween(sel.from, sel.to, " ");
        if (text.trim()) {
          return {
            kind: "selection",
            chapter,
            pos: sel.from,
            blockTag: $pos.parent.type.name,
            selection: { text, chapter: chapterAtPos(doc, sel.from) },
            rect: rectOf($pos.before($pos.depth)),
          };
        }
      }

      // 2. Image — resolve the node so its attrs can be rewritten in place.
      const imgEl = pointEl?.closest?.("img") ?? null;
      if (imgEl) {
        const imgPos = editor.view.posAtDOM(imgEl, 0);
        const node = doc.nodeAt(imgPos);
        if (node?.type.name === "image") {
          const a = node.attrs as {
            src: string;
            alt: string;
            title: string | null;
            gpAttrs?: string;
          };
          return {
            kind: "image",
            chapter: chapterAtPos(doc, imgPos),
            pos: imgPos,
            blockTag: "image",
            image: {
              src: a.src ?? "",
              alt: a.alt ?? "",
              title: a.title ?? null,
              attrsRaw: a.gpAttrs ?? "",
            },
            rect: rectOf(imgPos),
          };
        }
      }

      // 3. Link — the mark carrying the point. Probe one position INSIDE the
      // anchor: `posAtDOM(el, 0)` lands on the mark's start boundary, and a
      // link mark is non-inclusive there, so `marks()` at the boundary comes
      // back empty and every link would degrade to a plain block.
      const linkEl = pointEl?.closest?.("a[href]") ?? null;
      if (linkEl) {
        const linkPos = editor.view.posAtDOM(linkEl, 0);
        const inside = Math.min(Math.max(linkPos + 1, 0), doc.content.size);
        const $link = doc.resolve(inside);
        const mark = $link.marks().find((m) => m.type.name === "link");
        if (mark) {
          const r = (linkEl as HTMLElement).getBoundingClientRect();
          return {
            kind: "link",
            chapter: chapterAtPos(doc, inside),
            // A position strictly inside the mark, so the host's setLink can
            // find it again without hitting the same boundary problem.
            pos: inside,
            blockTag: "link",
            link: {
              href: (mark.attrs as { href: string }).href ?? "",
              text: (linkEl.textContent ?? "").trim(),
            },
            rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          };
        }
      }

      // 4/5. Marker wrapper, opaque block, or plain block.
      for (let d = $pos.depth; d >= 1; d--) {
        const n = $pos.node(d);
        if (n.type.name === "markerWrap" || n.type.name === "rawBlock") {
          const at = $pos.before(d);
          return {
            kind: n.type.name === "markerWrap" ? "marker" : "block",
            chapter,
            pos: at,
            blockTag: n.type.name,
            src: (n.attrs as { src?: string }).src,
            rect: rectOf(at),
          };
        }
      }
      const nodeAt = doc.nodeAt(found.inside >= 0 ? found.inside : found.pos);
      if (nodeAt?.type.name === "rawBlock" || nodeAt?.type.name === "markerAtom") {
        const at = found.inside >= 0 ? found.inside : found.pos;
        return {
          kind: nodeAt.type.name === "markerAtom" ? "marker" : "block",
          chapter,
          pos: at,
          blockTag: nodeAt.type.name,
          src: (nodeAt.attrs as { src?: string }).src,
          rect: rectOf(at),
        };
      }
      const blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : found.pos;
      return {
        kind: "block",
        chapter,
        pos: blockPos,
        blockTag: $pos.parent.type.name,
        rect: rectOf(blockPos),
      };
    },

    setImageAttrs(pos, changes) {
      const node = editor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "image") return false;
      const tr = editor.state.tr;
      if (changes.src !== undefined) tr.setNodeAttribute(pos, "src", changes.src);
      if (changes.alt !== undefined) tr.setNodeAttribute(pos, "alt", changes.alt);
      if (changes.title !== undefined) tr.setNodeAttribute(pos, "title", changes.title);
      if (changes.attrsRaw !== undefined) tr.setNodeAttribute(pos, "gpAttrs", changes.attrsRaw);
      if (!tr.steps.length) return false;
      editor.view.dispatch(tr);
      return true;
    },

    setLink(spec) {
      const linkType = editor.state.schema.marks.link;
      if (!linkType) return false;
      const { doc } = editor.state;
      let { from, to } = editor.state.selection;
      // Collapsed selection (or an explicit pos): operate on the whole link
      // run under it, the way every editor's "edit link" behaves.
      if (from === to) {
        // Probe `at` and `at + 1`: a caret sitting on the mark's start
        // boundary reports no link mark (link marks are non-inclusive), so a
        // boundary-only probe would refuse every edit.
        const raw = spec.pos ?? from;
        const clamp = (n: number) => Math.min(Math.max(n, 0), doc.content.size);
        let $at = doc.resolve(clamp(raw));
        let mark = $at.marks().find((m) => m.type.name === "link");
        if (!mark) {
          $at = doc.resolve(clamp(raw + 1));
          mark = $at.marks().find((m) => m.type.name === "link");
        }
        if (!mark) return false;
        // Expand to the whole contiguous run carrying the SAME link mark —
        // "edit link" acts on the link, not on one character of it.
        const parentStart = $at.start($at.depth);
        let start = $at.pos;
        let end = $at.pos;
        let offset = 0;
        $at.parent.forEach((child) => {
          const cFrom = parentStart + offset;
          const cTo = cFrom + child.nodeSize;
          offset += child.nodeSize;
          if (!child.isText || !mark!.isInSet(child.marks)) return;
          // Adjacent runs of the same mark are one link.
          if (cTo >= $at.pos && cFrom <= $at.pos) {
            start = Math.min(start, cFrom);
            end = Math.max(end, cTo);
          }
        });
        if (start === end) return false;
        from = start;
        to = end;
      }
      if (from === to) return false;
      const tr = editor.state.tr.removeMark(from, to, linkType);
      if (spec.href) tr.addMark(from, to, linkType.create({ href: spec.href, title: null }));
      editor.view.dispatch(tr);
      return true;
    },

    destroy() {
      destroyed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (saveTimer) clearTimeout(saveTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("gp:relayout", onRelayout);
      void ready.catch(() => {});
      editor.destroy();
    },
  };
}
