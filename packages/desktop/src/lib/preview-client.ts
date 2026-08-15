/**
 * Client for the cross-origin preview-bridge.js running inside the preview iframe.
 * Sends commands via postMessage and tracks replies by id.
 */
export interface PreviewEvent {
  name:
    | "pageChanged"
    | "renderingStarted"
    | "renderingCancelled"
    | "renderingComplete"
    | "ready"
    | "viewportChanged"
    | "sourceLineChanged"
    | "elementActivated"
    | "contextMenuRequested"
    // Inline editing (protocol v7, ADR 0010):
    | "editPatches"
    | "editDrift"
    | "editStateChanged"
    | "editSelection";
  detail: {
    currentPage?: number;
    totalPages?: number;
    /** sourceLineChanged / elementActivated: 1-based markdown source line. */
    sourceLine?: number | null;
    /** sourceLineChanged / elementActivated: chapter (source filename) the block belongs to. */
    chapter?: string | null;
    /** sourceLineChanged: page the top-visible block sits on. */
    page?: number;
    /** renderingComplete: true for a save-triggered shell update. */
    hotReload?: boolean;
    /** renderingComplete: browser-side pagination/update latency for a hot reload. */
    hotReloadMs?: number;
    /** renderingComplete: acknowledged preview content revision. */
    revision?: number;
    /** renderingComplete: whether the shell spliced one chapter or replaced the book frame. */
    updateMode?: "chapter-splice" | "full-reload";
    /** elementActivated: clicked element id / tag, if any. */
    id?: string | null;
    tag?: string;
    /** contextMenuRequested: what kind of thing is at the resolved target — see ADR 0009. */
    kind?: ContextTargetKind;
    /** contextMenuRequested: data-source-range [start, end) of the innermost annotated block. */
    range?: SourceRange | null;
    /** contextMenuRequested: tag name of the innermost annotated block (e.g. "code" for a fence). */
    blockTag?: string | null;
    /** contextMenuRequested: true when the target fragment carries data-split-from/-to. */
    split?: boolean;
    /** contextMenuRequested: the target fragment's rect (post-zoom, plain object — no DOMRect). */
    rect?: PlainRect | null;
    /** contextMenuRequested: populated whenever the point is on/in an <img>, regardless of `kind`. */
    image?: { src: string | null; alt: string | null; source: InlineSourceToken | null } | null;
    /** contextMenuRequested: populated whenever the point is on/in an <a>, regardless of `kind`. */
    link?: { href: string | null; text: string; source: InlineSourceToken | null } | null;
    /** contextMenuRequested: populated whenever a non-collapsed selection exists, regardless of `kind`. */
    selection?: ContextTargetSelection | null;
    /** contextMenuRequested: viewport point the menu was requested at. */
    x?: number;
    /** contextMenuRequested: viewport point the menu was requested at. */
    y?: number;
    /** contextMenuRequested: how the menu was invoked. */
    via?: "mouse" | "keyboard";
  };
}

/** A `data-source-range` value — token.map's own 0-based half-open `[start, end)` convention. */
export type SourceRange = [number, number];

/** Parser-owned coordinates for one rendered Markdown image/link token. */
export interface InlineSourceToken {
  token: string;
  occurrence: number;
}

/** `getContextTargetAt()` / `contextMenuRequested`'s `kind` (protocol v4, ADR 0009). Precedence:
 * selection -> image -> link -> marker -> block -> none. */
export type ContextTargetKind = "selection" | "image" | "link" | "marker" | "block" | "none";

/** A JSON-cloneable rect — never a DOMRect (the payload crosses two postMessage boundaries). */
export interface PlainRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** `getContextTargetAt()`'s `selection` field — populated for any non-collapsed selection. */
export interface ContextTargetSelection {
  /** `selection.toString()` — NEVER `Range.toString()` (cross-page ranges pick up structural whitespace). */
  text: string;
  /** True only when both selection endpoints resolve to the same annotated block. */
  withinSingleBlock: boolean;
  /** That block's source range — only set when `withinSingleBlock`. */
  range: SourceRange | null;
  /** That block's chapter — only set when `withinSingleBlock`. */
  chapter: string | null;
}

/** The full payload returned by `getContextTargetAt()` (protocol v4, ADR 0009). */
export interface ContextTarget {
  kind: ContextTargetKind;
  chapter: string | null;
  range: SourceRange | null;
  blockTag: string | null;
  split: boolean;
  rect: PlainRect | null;
  image: { src: string | null; alt: string | null; source: InlineSourceToken | null } | null;
  link: { href: string | null; text: string; source: InlineSourceToken | null } | null;
  selection: ContextTargetSelection | null;
}

/**
 * A single fragment's geometry from `getRectsFor()` (protocol v5, inline-
 * editing plan §5.3, ADR 0009) — plain and JSON-cloneable, `page` is the
 * fragment's own 1-based page number (a split block's fragments can land on
 * different pages).
 */
export interface PreviewRect {
  top: number;
  left: number;
  width: number;
  height: number;
  page: number;
}

/**
 * `getRectsFor()`'s result: every fragment rect for one logical block.
 * `rects` is empty when nothing resolves — a range that no longer matches
 * anything in `chapter` (the block was deleted/moved).
 */
export interface RectsForResult {
  rects: PreviewRect[];
}

/** Target form for `getRectsFor()` (§5.3). */
export type RectsForTarget = { chapter: string; range: SourceRange };

/** A heading from getOutline() — see ADR 0005. */
export interface OutlineEntry {
  level: number;
  text: string;
  id: string | null;
  sourceLine: number | null;
  /** Source filename (data-chapter-src) the heading belongs to. */
  chapter: string | null;
  page: number;
  index: number;
}

/**
 * Target for scrollTo()/highlight() — exactly one positional form is honoured.
 * A line is per-file, so pair it with `chapter` (source filename) in a
 * multi-chapter book to disambiguate.
 */
export type PreviewTarget =
  | { line: number; chapter?: string | null }
  | { id: string }
  | { selector: string }
  | { page: number };

export class PreviewClient {
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  private listeners = new Set<(e: PreviewEvent) => void>();
  private win: Window | null = null;
  /**
   * The exact origin `attach()`-ed messages are accepted from and posted to
   * (M31, 2026-07-10 UX review). Pinned via `setExpectedOrigin()` — NOT read
   * from the iframe's own `window.location`, which throws for a cross-origin
   * frame (the preview iframe always is: http://127.0.0.1 inside app://).
   * Null means "no origin pinned yet" and every message is rejected /
   * `call()` refuses to send — fail closed, never fall back to `'*'`.
   */
  private expectedOrigin: string | null = null;
  /**
   * Once true, `attach()` is a permanent no-op (M31). Set for URL-preview
   * mode, where the SAME PreviewFrame+Client loads an arbitrary third-party
   * page — that page must never be allowed to drive render state, page
   * counts, or toasts via a spoofed `gutterpress:event`/`gutterpress:reply` message.
   */
  private locked = false;
  private handler: (e: MessageEvent) => void;

  constructor() {
    this.handler = (e: MessageEvent) => {
      // M31: only accept messages from the exact window this client is
      // attached to, at the exact origin pinned via setExpectedOrigin(). The
      // preview iframe is cross-origin by design, and in URL-preview mode
      // shows an arbitrary third-party page — without this check any page
      // (or any other frame in the document) could spoof gutterpress:reply/gutterpress:event
      // messages to drive render state, page counts, and success toasts.
      if (!this.win || !this.expectedOrigin) return;
      if (e.source !== this.win || e.origin !== this.expectedOrigin) return;
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "gutterpress:reply") {
        const cb = this.pending.get(data.id);
        if (cb) {
          this.pending.delete(data.id);
          cb(data);
        }
      } else if (data.type === "gutterpress:event") {
        for (const l of this.listeners) l({ name: data.name, detail: data.detail });
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.handler);
    }
  }

  /**
   * Pin the exact origin this client will accept messages from / target with
   * postMessage (M31). Callers know the iframe's destination URL up front
   * (PreviewFrame's `url` prop / +page.svelte's `previewUrl`/`currentUrl`)
   * well before the iframe's "load" event calls attach() — pass that URL
   * here first. A no-op after lockDown().
   */
  setExpectedOrigin(url: string | null | undefined) {
    if (this.locked) return;
    if (!url) {
      this.expectedOrigin = null;
      return;
    }
    try {
      this.expectedOrigin = new URL(url).origin;
    } catch {
      this.expectedOrigin = null;
    }
  }

  /**
   * Permanently refuse to attach / exchange messages (M31). Call this instead
   * of attach() in URL-preview mode — the frame shows an arbitrary
   * third-party page, so the command/event bridge must never be wired up at
   * all, not merely restricted to an origin (a page can't be trusted to not
   * pretend to BE the pinned origin's content in the first place).
   */
  lockDown() {
    this.locked = true;
    this.win = null;
    this.expectedOrigin = null;
  }

  attach(win: Window | null) {
    if (this.locked) return;
    this.win = win;
  }

  detach() {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.handler);
    }
    this.pending.clear();
    this.listeners.clear();
    this.win = null;
    this.expectedOrigin = null;
  }

  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async call<T = unknown>(cmd: string, args: unknown[] = []): Promise<T> {
    // M31: require a pinned origin, not just an attached window — never fall
    // back to '*'. `setExpectedOrigin` must run before this can send.
    if (!this.win || !this.expectedOrigin) throw new Error("Preview frame not attached");
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.ok) resolve(msg.result as T);
        else reject(new Error(msg.error || "Unknown error"));
      });
      this.win!.postMessage({ type: "gutterpress:cmd", id, cmd, args }, this.expectedOrigin!);
      // Timeout long-pending commands so promises don't leak forever.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Command '${cmd}' timed out`));
        }
      }, 10_000);
    });
  }

  // ── ADR 0005 typed convenience wrappers ──────────────────────────────────
  // Thin sugar over call(); features compose these host-side so the lib bridge
  // never needs a feature-specific command.

  /** Protocol version of the bundled lib bridge (feature-detect). 1 = pre-ADR-0005. */
  async getProtocolVersion(): Promise<number> {
    try {
      return await this.call<number>("getProtocolVersion");
    } catch {
      return 1;
    }
  }

  /** Heading tree with page + source line. */
  getOutline(): Promise<OutlineEntry[]> {
    return this.call<OutlineEntry[]>("getOutline");
  }

  /** Scroll the preview to a line / id / selector / page. */
  scrollTo(
    target: PreviewTarget,
    opts?: { block?: "start" | "center"; smooth?: boolean },
  ): Promise<{ page: number; sourceLine: number | null } | null> {
    return this.call("scrollTo", [target, opts ?? {}]);
  }

  /** Source line, chapter, and page of the block at the top of the viewport. */
  getVisibleSource(): Promise<{
    sourceLine: number | null;
    chapter: string | null;
    page: number;
  } | null> {
    return this.call("getVisibleSource");
  }

  /** Resolve the annotated element/selection at a viewport point (protocol v4, context menu). */
  getContextTargetAt(point: { x: number; y: number }): Promise<ContextTarget> {
    return this.call<ContextTarget>("getContextTargetAt", [point]);
  }

  /**
   * All fragment rects for one logical block, keyed by `{chapter, range}`
   * (protocol v6, block overlay — inline-editing plan §5.3). A source range is
   * duplicated verbatim onto every split fragment (Paged.js clones a block
   * across pages but copies every data attribute to each clone), so it
   * identifies the whole fragment set on its own — no separate ref needed,
   * and it survives a fresh render (a splice mints fresh DOM but the same
   * range) without a post-splice fallback.
   */
  // ── protocol v7: inline editing (ADR 0010) ────────────────────────────

  /** Turn the in-frame edit surface on/off. */
  setEditMode(spec: { on: boolean; features?: Record<string, boolean> }): Promise<{ on: boolean }> {
    return this.call<{ on: boolean }>("setEditMode", [spec]);
  }

  /** Report per-patch commit outcomes back to the frame (mirror update +
   *  range shifting + drift verification happen there). */
  ackEditPatches(spec: {
    batchId: number;
    results: Array<{
      chapter: string;
      range: [number, number];
      status: "applied" | "refused" | "failed";
      reason?: string;
    }>;
  }): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("ackEditPatches", [spec]);
  }

  /** Converge-on-drift pass for one chapter (frame-side fetch + heal). */
  verifyChapter(spec: { chapter: string }): Promise<{ healed: number; mismatch?: string }> {
    return this.call<{ healed: number; mismatch?: string }>("verifyChapter", [spec]);
  }

  /** Force all sub-debounce dirty blocks into proposals (pre-swap flush). */
  flushEditState(): Promise<void> {
    return this.call<void>("flushEditState", []);
  }

  /** Toggle bold/italic/strike/code on the frame's current selection. */
  applyInlineFormat(spec: { format: "bold" | "italic" | "strike" | "code" }): Promise<{ applied: boolean }> {
    return this.call<{ applied: boolean }>("applyInlineFormat", [spec]);
  }

  getRectsFor(target: RectsForTarget): Promise<RectsForResult> {
    return this.call<RectsForResult>("getRectsFor", [target]);
  }

  /**
   * Toggle a masking class on every fragment matching `{chapter, range}`,
   * plus the book document's own scroll lock (protocol v6, block overlay —
   * inline-editing plan §5.1/§5.3). Purely cosmetic and reversible; `masked:
   * false` clears the scroll lock even when the range no longer resolves to
   * any live fragment (defense-in-depth teardown after a splice already
   * replaced the DOM).
   */
  setEditMask(spec: { chapter: string; range: SourceRange; masked: boolean }): Promise<{ count: number }> {
    return this.call<{ count: number }>("setEditMask", [spec]);
  }

  /** Read-only DOM extraction (figures, links, footnotes, search candidates…). */
  queryDom(spec: {
    selector: string;
    fields?: Array<
      "text" | "id" | "sourceLine" | "page" | "tag" | "rectTop" | { attr: string }
    >;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    return this.call("queryDom", [spec]);
  }

  /** Mark matched elements with a highlight class (find, cursor-echo, annotations). */
  highlight(spec: {
    line?: number;
    id?: string;
    selector?: string;
    group?: string;
    scroll?: boolean;
    transient?: boolean;
    transientMs?: number;
  }): Promise<{ count: number }> {
    return this.call("highlight", [spec]);
  }

  clearHighlights(group?: string): Promise<{ cleared: number }> {
    return this.call("clearHighlights", [group]);
  }

  setBgColor(color: string) {
    if (!this.win || !this.expectedOrigin) return;
    this.win.postMessage({ type: "gutterpress:bg-color", color }, this.expectedOrigin);
  }

  /**
   * Inject (or replace) a named <style> block inside the iframe's <head>.
   * @param id   Unique identifier used as the data-gutterpress-{id} attribute.
   * @param css  CSS text to write into the style block.
   */
  injectStyles(id: string, css: string) {
    if (!this.win || !this.expectedOrigin) return;
    this.win.postMessage({ type: "gutterpress:inject-styles", id, css }, this.expectedOrigin);
  }
}
