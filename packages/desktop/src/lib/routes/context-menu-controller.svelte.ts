/**
 * ContextMenuController — single owner of the preview right-click/`Shift+F10`
 * context menu's open/position/target state (inline-editing plan §4.1–4.5,
 * PR 3).
 *
 * `.svelte.ts` suffix is deliberate: menu open/position/items are `$state`
 * consumed by `ContextMenu.svelte`, matching `page-nav-controller.svelte.ts` /
 * `zoom-view-controller.svelte.ts`.
 *
 * Subscribes to the preview client via its OWN `client.on()` listener —
 * separate from `PreviewEventController`'s switch (PR 0 already owns the
 * `elementActivated` case there; this controller neither touches nor
 * duplicates it, per the plan's ownership split).
 *
 * Host coupling (the preview client, the buffer/editor accessors, the commit
 * engine, geometry, and the small text-prompt/toast/clipboard/media-panel
 * glue) is injected so this stays testable with fakes and PWA-clean (§8 /
 * ADR 0004): ZERO direct DOM / `node:*` / lib value imports. Menu-item
 * parameter resolution (image/link token matching) is delegated to the pure
 * helpers in `$lib/editor/context-menu-actions`; the write path is entirely
 * `commit-engine.ts` — this controller never touches a file directly.
 */
import type { PreviewEvent, ContextTarget, SourceRange } from "$lib/preview-client";
import type { CommitEngine } from "$lib/editor/commit-engine";
import { chapterPath } from "$lib/editor/chapter-path";
import { buildLineStarts, charRange } from "$lib/editor/source-range";
import {
  findImageToken,
  hasRawHtmlImg,
  resolveLinkToken,
  spliceToken,
  type LinkResolution,
} from "$lib/editor/context-menu-actions";
import { buildImageAttrsString } from "$lib/editor/toolbar-actions";
import {
  locateSelectionInSource,
  touchesStructuralSyntax,
  hasSameDelimiter,
  wrapDelimiter,
  type FormatKind,
} from "$lib/editor/selection-search";

/** Minimal preview-client surface the controller drives. */
export interface ContextMenuClient {
  on(fn: (e: PreviewEvent) => void): () => void;
}

/** The live editor buffer's minimal surface the controller peeks at (never mutates). */
export interface ContextMenuBuffer {
  filePath: string | null;
  content: string;
}

/** A `getBoundingClientRect()`-shaped rect, spread into a plain object. */
export interface ContextMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContextMenuDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => ContextMenuClient | undefined;
  /** `preview.contextMenu` setting — false disables the whole feature. */
  enabled: () => boolean;
  /** True while a preview render is in flight (ignore contextMenuRequested). */
  rendering: () => boolean;
  /** The open project directory, or null when none is loaded. */
  currentDir: () => string | null;
  /** The live editor buffer, or null before it has been constructed. */
  buffer: () => ContextMenuBuffer | null;
  /**
   * Read a chapter's file DIRECTLY — NOT through `selectEditorFile`. Menu
   * open must never disturb which file the editor pane shows; this is used
   * only to peek at a chapter's current source for menu-item resolution when
   * it isn't already the buffer's open file.
   */
  readFile: (path: string) => Promise<string>;
  /** The commit engine — owns the write path AND the edit-generation counter. */
  commitEngine: CommitEngine;
  /** The preview iframe's own `getBoundingClientRect()` (left/top only needed), or null if unmounted. */
  getIframeOrigin: () => { left: number; top: number } | null;
  /** The workspace container's rect, for clamping the menu on-screen. */
  getWorkspaceRect: () => ContextMenuRect | null;
  /** A small modal text prompt. Null return = cancelled (plan §4.4's marker/image/link prompts). */
  promptText: (opts: { title: string; label: string; initialValue: string }) => Promise<string | null>;
  /** Reveal a chapter/line in the editor, opening the pane if needed (mirrors PR 0's onElementActivated). */
  goToSource: (chapter: string, line: number) => void;
  /** Switch the left panel to the Media tab ("Reveal in Media panel"). */
  openMediaPanel: () => void;
  /** Copy text to the OS clipboard. */
  copyToClipboard: (text: string) => Promise<void>;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  /**
   * Open the click-to-edit block overlay on this block (PR 5,
   * `block-overlay-controller.svelte.ts`) — the "Edit this block" item's
   * destination, closing the menu itself is this controller's job, not the
   * overlay's.
   */
  openBlockOverlay: (chapter: string, range: SourceRange, ref: string | null) => void;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  /** Tooltip explaining why the item is disabled; undefined when enabled. */
  disabledReason?: string;
  run: () => void | Promise<void>;
}

/** Default size estimate used to clamp the menu on open, BEFORE the component
 *  has mounted and can report its real size via {@link ContextMenuController.reportMenuSize}. */
const ESTIMATED_WIDTH = 240;
const ESTIMATED_HEIGHT = 260;

/**
 * `data-chapter-src` crosses the untrusted preview bridge (plan §3.5) —
 * reject anything that isn't a plain forward-slash-relative id before it is
 * ever joined onto the project directory. Mirrors `commit-engine.ts`'s
 * identical guard (kept local rather than shared to avoid a needless public
 * export from the write-path module for what is, here, a read-only peek).
 */
function isSafeChapterId(chapter: string): boolean {
  if (!chapter) return false;
  if (chapter.startsWith("/") || chapter.includes("\\")) return false;
  if (/^[a-zA-Z]:/.test(chapter)) return false;
  return chapter.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function linkDisabledReason(kind: LinkResolution["kind"]): string {
  switch (kind) {
    case "reference-style":
      return "This is a reference-style link — edit it in the editor.";
    case "linkified":
      return "This is a plain web address, not a markdown link — edit it in the editor.";
    default:
      return "Couldn't locate this link in the source.";
  }
}

export class ContextMenuController {
  private deps: ContextMenuDeps;

  // ── Public rune state (read by ContextMenu.svelte) ────────────────────────
  open = $state(false);
  x = $state(0);
  y = $state(0);
  items = $state<ContextMenuItem[]>([]);

  private rawX = 0;
  private rawY = 0;
  private target: ContextTarget | null = null;
  // Set for a short window right after open(), across the SAME event-loop
  // discipline as EditorToolbar.svelte's outside-click popover handling —
  // reused here defensively (plan §4.2) even though the menu's OPENING
  // interaction happens inside a different document (the preview iframe) and
  // so cannot itself bubble into this SPA's own outside-mousedown listener.
  private justOpened = false;

  constructor(deps: ContextMenuDeps) {
    this.deps = deps;
  }

  /** Subscribe to a preview client's event stream. Returns the unsubscribe fn. */
  subscribe(client: ContextMenuClient): () => void {
    return client.on((e) => this.handleEvent(e));
  }

  private handleEvent(e: PreviewEvent): void {
    switch (e.name) {
      case "contextMenuRequested":
        void this.handleContextMenuRequested(e.detail);
        break;
      case "renderingComplete":
        // Content changed under the menu (or a build just finished) — the
        // generation bump closes the clean-but-DOM-stale commit window
        // (plan §4.9); the menu itself is now anchored to stale geometry.
        this.deps.commitEngine.noteRenderingComplete();
        this.close();
        break;
      case "pageChanged":
        // Anchor invalidated (scroll/page navigation moved the target).
        this.close();
        break;
    }
  }

  private async handleContextMenuRequested(detail: PreviewEvent["detail"]): Promise<void> {
    if (!this.deps.enabled()) return;
    // Ignore while a render is in flight (same guard the sync controller uses).
    if (this.deps.rendering()) return;
    const kind = detail.kind;
    // PR 2's keyboard path can dispatch kind:"none" (anchor resolved to
    // nothing annotated); its mouse path cannot (native behavior is kept for
    // those clicks instead — see pagedjs-interface.js). Either way: no menu.
    if (!kind || kind === "none") return;

    const target: ContextTarget = {
      kind,
      chapter: detail.chapter ?? null,
      range: detail.range ?? null,
      blockTag: detail.blockTag ?? null,
      split: !!detail.split,
      ref: detail.ref ?? null,
      rect: detail.rect ?? null,
      image: detail.image ?? null,
      link: detail.link ?? null,
      selection: detail.selection ?? null,
    };

    const items = await this.buildItems(target);
    // A render/navigation could have raced the async item-build above.
    if (this.deps.rendering()) return;
    if (items.length === 0) return;

    this.target = target;
    this.items = items;
    this.rawX = detail.x ?? 0;
    this.rawY = detail.y ?? 0;
    const pos = this.computePosition(this.rawX, this.rawY, ESTIMATED_WIDTH, ESTIMATED_HEIGHT);
    this.x = pos.x;
    this.y = pos.y;
    this.open = true;
    this.justOpened = true;
    queueMicrotask(() => {
      this.justOpened = false;
    });
  }

  /** Called by `ContextMenu.svelte` once it mounts and can measure its own
   *  rendered size, to reflow the clamp/flip with the REAL dimensions. */
  reportMenuSize(width: number, height: number): void {
    if (!this.open) return;
    const pos = this.computePosition(this.rawX, this.rawY, width, height);
    this.x = pos.x;
    this.y = pos.y;
  }

  /** True during the brief window right after `open()` — see `justOpened`'s comment. */
  wasJustOpened(): boolean {
    return this.justOpened;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.items = [];
    this.target = null;
  }

  async runItem(item: ContextMenuItem): Promise<void> {
    if (!item.enabled) return;
    await item.run();
  }

  // ── Positioning (plan §4.2) ────────────────────────────────────────────────

  private computePosition(
    px: number,
    py: number,
    width: number,
    height: number,
  ): { x: number; y: number } {
    const origin = this.deps.getIframeOrigin();
    const baseX = (origin?.left ?? 0) + px;
    const baseY = (origin?.top ?? 0) + py;
    const workspace = this.deps.getWorkspaceRect();
    if (!workspace) return { x: baseX, y: baseY };

    const maxX = workspace.left + workspace.width;
    const maxY = workspace.top + workspace.height;
    // Flip near the right/bottom edge.
    let x = baseX + width > maxX ? baseX - width : baseX;
    let y = baseY + height > maxY ? baseY - height : baseY;
    // Clamp fully inside the workspace either way.
    x = Math.min(Math.max(x, workspace.left), Math.max(workspace.left, maxX - width));
    y = Math.min(Math.max(y, workspace.top), Math.max(workspace.top, maxY - height));
    return { x, y };
  }

  // ── Menu-item resolution (plan §4.3–4.4) ───────────────────────────────────

  private async readChapterSource(chapter: string): Promise<string | null> {
    const dir = this.deps.currentDir();
    if (!dir || !isSafeChapterId(chapter)) return null;
    const absPath = chapterPath(dir, chapter);
    const buf = this.deps.buffer();
    if (buf && buf.filePath === absPath) return buf.content;
    try {
      return await this.deps.readFile(absPath);
    } catch {
      return null;
    }
  }

  private sliceRange(source: string, range: SourceRange): string | null {
    try {
      const starts = buildLineStarts(source);
      const [from, to] = charRange(source, starts, range);
      return source.slice(from, to);
    } catch {
      return null;
    }
  }

  private async buildItems(target: ContextTarget): Promise<ContextMenuItem[]> {
    if (target.kind === "selection") {
      if (target.selection?.withinSingleBlock) return this.singleBlockSelectionItems(target);
      return this.crossBlockSelectionItems(target);
    }
    if (!target.chapter || !target.range) return [];
    const gen = this.deps.commitEngine.generation;
    const source = await this.readChapterSource(target.chapter);
    const blockSlice = source != null ? this.sliceRange(source, target.range) : null;

    switch (target.kind) {
      case "image":
        return this.imageItems(target, blockSlice, gen);
      case "link":
        return this.linkItems(target, blockSlice, gen);
      case "marker":
        return this.markerItems(target, gen);
      case "block":
        return this.blockItems(target, gen);
      default:
        return [];
    }
  }

  private editBlockItem(
    target: ContextTarget,
    disabledReason?: string,
    /**
     * Overrides `target.chapter`/`target.range` (the RIGHT-CLICK POINT's
     * resolved block) with an explicit chapter/range. Used by the selection-
     * formatting row (plan §4.6): a selection's anchor block
     * (`selection.chapter`/`selection.range`) is the block actually being
     * formatted and can, in principle, differ from the point the
     * context-menu event fired at — "Edit block in editor" for that row must
     * jump to the block being formatted, not wherever the pointer happened
     * to land.
     */
    override?: { chapter: string; range: SourceRange },
  ): ContextMenuItem {
    const chapter = override?.chapter ?? target.chapter;
    const range = override?.range ?? target.range;
    return {
      id: "edit-block-editor",
      label: "Edit block in editor",
      enabled: !disabledReason,
      disabledReason,
      run: () => {
        if (chapter && range) this.deps.goToSource(chapter, range[0] + 1);
        this.close();
      },
    };
  }

  private async commit(
    chapter: string,
    range: SourceRange,
    expected: string,
    replacement: string,
    expectedGeneration: number,
  ): Promise<void> {
    const outcome = await this.deps.commitEngine.commitRangePatch({
      chapter,
      range,
      expected,
      replacement,
      expectedGeneration,
    });
    this.close();
    if (!outcome.ok) {
      this.deps.toastError(outcome.message);
      return;
    }
    if (outcome.flushed) this.deps.toastSuccess("Updated.");
    // When !outcome.flushed, buffer.flush() detected an external change and
    // the buffer's OWN conflict banner is already showing (plan §4.7 Step 5)
    // — nothing further to say here.
  }

  // ── Image (plan §4.3–4.4) ───────────────────────────────────────────────────

  private imageItems(target: ContextTarget, blockSlice: string | null, gen: number): ContextMenuItem[] {
    const chapter = target.chapter!;
    const range = target.range!;
    const image = target.image;
    if (blockSlice == null || !image) {
      return [this.editBlockItem(target, "Couldn't read this chapter's source.")];
    }
    const match = findImageToken(blockSlice, image);
    if (!match && hasRawHtmlImg(blockSlice)) {
      // Raw HTML <img> — no markdown token to address (plan §2.6).
      return [this.editBlockItem(target)];
    }
    const disabledReason = match ? undefined : "Couldn't locate this image in the source.";
    const slice = blockSlice; // narrowed for closures below
    const items: ContextMenuItem[] = [
      {
        id: "image-alt",
        label: "Edit alt text…",
        enabled: !!match,
        disabledReason,
        run: async () => {
          if (!match) return;
          const next = await this.deps.promptText({
            title: "Edit alt text",
            label: "Alt text",
            initialValue: match.alt,
          });
          if (next == null) return;
          const token = `![${next}](${match.src})${match.attrsRaw}`;
          await this.commit(chapter, range, slice, spliceToken(slice, match.start, match.end, token), gen);
        },
      },
      {
        id: "image-width",
        label: "Set width…",
        enabled: !!match,
        disabledReason,
        run: async () => {
          if (!match) return;
          const current = parseWidth(match.attrsRaw);
          const next = await this.deps.promptText({
            title: "Set width",
            label: "Width (e.g. 300px, 50%) — leave blank to clear",
            initialValue: current,
          });
          if (next == null) return;
          const attrs = buildImageAttrsString(next || undefined, parsePosition(match.attrsRaw));
          const token = `![${match.alt}](${match.src})${attrs}`;
          await this.commit(chapter, range, slice, spliceToken(slice, match.start, match.end, token), gen);
        },
      },
      {
        id: "image-position",
        label: "Set position…",
        enabled: !!match,
        disabledReason,
        run: async () => {
          if (!match) return;
          const current = parsePosition(match.attrsRaw) ?? "";
          const next = await this.deps.promptText({
            title: "Set position",
            label: "left, right, center, or leave blank",
            initialValue: current,
          });
          if (next == null) return;
          const attrs = buildImageAttrsString(parseWidth(match.attrsRaw) || undefined, next || undefined);
          const token = `![${match.alt}](${match.src})${attrs}`;
          await this.commit(chapter, range, slice, spliceToken(slice, match.start, match.end, token), gen);
        },
      },
      {
        id: "image-replace",
        label: "Replace image…",
        enabled: !!match,
        disabledReason,
        run: async () => {
          if (!match) return;
          const next = await this.deps.promptText({
            title: "Replace image",
            label: "New image path or URL",
            initialValue: match.src,
          });
          if (!next) return;
          const token = `![${match.alt}](${next})${match.attrsRaw}`;
          await this.commit(chapter, range, slice, spliceToken(slice, match.start, match.end, token), gen);
        },
      },
      {
        id: "image-reveal",
        label: "Reveal in Media panel",
        enabled: true,
        run: () => {
          this.deps.openMediaPanel();
          this.close();
        },
      },
      this.editBlockItem(target),
    ];
    return items;
  }

  // ── Link (plan §4.3–4.4) ────────────────────────────────────────────────────

  private linkItems(target: ContextTarget, blockSlice: string | null, gen: number): ContextMenuItem[] {
    const chapter = target.chapter!;
    const range = target.range!;
    const link = target.link;
    const resolution: LinkResolution =
      blockSlice != null && link ? resolveLinkToken(blockSlice, link) : { kind: "not-found" };
    const editEnabled = resolution.kind === "found";
    const slice = blockSlice;
    const items: ContextMenuItem[] = [
      {
        id: "link-edit",
        label: "Edit link…",
        enabled: editEnabled,
        disabledReason: editEnabled ? undefined : linkDisabledReason(resolution.kind),
        run: async () => {
          if (resolution.kind !== "found" || slice == null) return;
          const next = await this.deps.promptText({
            title: "Edit link",
            label: "Web address",
            initialValue: resolution.match.href,
          });
          if (next == null) return;
          const token = `[${resolution.match.text}](${next})`;
          await this.commit(
            chapter,
            range,
            slice,
            spliceToken(slice, resolution.match.start, resolution.match.end, token),
            gen,
          );
        },
      },
      {
        id: "link-copy",
        label: "Copy link target",
        enabled: !!link?.href,
        disabledReason: link?.href ? undefined : "No link target to copy.",
        run: async () => {
          if (link?.href) await this.deps.copyToClipboard(link.href);
          this.close();
        },
      },
      this.editBlockItem(target),
    ];
    return items;
  }

  // ── Marker (plan §4.3–4.4) ──────────────────────────────────────────────────

  private markerItems(target: ContextTarget, gen: number): ContextMenuItem[] {
    const chapter = target.chapter!;
    const range = target.range!;
    const items: ContextMenuItem[] = [
      {
        id: "marker-edit",
        label: "Edit marker…",
        enabled: true,
        run: async () => {
          const source = await this.readChapterSource(chapter);
          const slice = source != null ? this.sliceRange(source, range) : null;
          if (slice == null) {
            this.deps.toastError("Couldn't locate this marker in the source.");
            this.close();
            return;
          }
          const trailingNl = slice.match(/(\r\n?|\n)$/)?.[0] ?? "";
          const rawLine = slice.slice(0, slice.length - trailingNl.length);
          const next = await this.deps.promptText({
            title: "Edit marker",
            label: "Marker line",
            initialValue: rawLine,
          });
          if (next == null) return;
          await this.commit(chapter, range, slice, next + trailingNl, gen);
        },
      },
      {
        id: "marker-source",
        label: "Go to source",
        enabled: true,
        run: () => {
          this.deps.goToSource(chapter, range[0] + 1);
          this.close();
        },
      },
    ];
    return items;
  }

  // ── Block (plan §4.3) ───────────────────────────────────────────────────────

  private blockItems(target: ContextTarget, gen: number): ContextMenuItem[] {
    const chapter = target.chapter!;
    const range = target.range!;
    // Note: the block slice itself is unused here — the insert actions below
    // are zero-width boundary edits that never touch the target block's text
    // (see block-break-before/after's own comment).
    const items: ContextMenuItem[] = [
      {
        id: "block-edit",
        label: "Edit this block",
        enabled: true,
        run: () => {
          this.deps.openBlockOverlay(chapter, range, target.ref);
          this.close();
        },
      },
      {
        id: "block-break-before",
        label: "Insert page break before",
        enabled: true,
        run: async () => {
          // A zero-width insert AT the block's own start line — `expected`
          // is trivially "" and the target block's text is never touched
          // (mirrors the §5.5 boundary-insert rule the overlay will reuse).
          await this.commit(chapter, [range[0], range[0]], "", "@page-break\n\n", gen);
        },
      },
      {
        id: "block-break-after",
        label: "Insert page break after",
        enabled: true,
        run: async () => {
          await this.commit(chapter, [range[1], range[1]], "", "@page-break\n\n", gen);
        },
      },
      {
        id: "block-source",
        label: "Go to source",
        enabled: true,
        run: () => {
          this.deps.goToSource(chapter, range[0] + 1);
          this.close();
        },
      },
    ];
    return items;
  }

  // ── Selection formatting (plan §4.3, §4.6 — PR 4) ───────────────────────────

  private static readonly AMBIGUOUS_REASON =
    "Couldn't locate this text uniquely in the source — open the editor";
  private static readonly STRUCTURE_REASON =
    "This selection includes code or link syntax — edit it in the editor.";
  private static readonly FORMAT_KINDS: ReadonlyArray<{
    id: string;
    label: string;
    kind: FormatKind;
  }> = [
    { id: "format-bold", label: "Bold", kind: "bold" },
    { id: "format-italic", label: "Italic", kind: "italic" },
    { id: "format-strike", label: "Strikethrough", kind: "strike" },
    { id: "format-code", label: "Inline code", kind: "code" },
  ];

  /**
   * A single-block selection's formatting row (plan §4.6). The preview gives
   * us `selection.text` — RENDERED text — which must be located inside the
   * block's raw markdown source before it can be wrapped; see
   * `$lib/editor/selection-search.ts` for the whitespace/typographer/
   * delimiter matching this delegates to. Every disabled path here (no
   * match, structural syntax, same-delimiter nesting) degrades to "Edit
   * block in editor" only — never a guessed edit (plan §1 principle 3).
   *
   * Uses `selection.chapter`/`selection.range` (the selection's OWN anchor
   * block), never `target.chapter`/`target.range` (the right-click POINT's
   * resolved block, which for a selection is populated from `pointEl` and
   * is not guaranteed to be the same block — see `pagedjs-interface.js`'s
   * `buildContextTarget`).
   */
  private async singleBlockSelectionItems(target: ContextTarget): Promise<ContextMenuItem[]> {
    const sel = target.selection;
    if (!sel || !sel.chapter || !sel.range) {
      return [this.editBlockItem(target)];
    }
    const chapter = sel.chapter;
    const range = sel.range;
    const editItem = this.editBlockItem(target, undefined, { chapter, range });

    const gen = this.deps.commitEngine.generation;
    const source = await this.readChapterSource(chapter);
    const blockSlice = source != null ? this.sliceRange(source, range) : null;
    if (blockSlice == null) {
      return [this.editBlockItem(target, "Couldn't read this chapter's source.", { chapter, range })];
    }

    const match = locateSelectionInSource(blockSlice, sel.text);
    if (!match) {
      return [
        ...ContextMenuController.FORMAT_KINDS.map(({ id, label }) => this.disabledFormatItem(id, label)),
        this.disabledFormatItem("format-link", "Make link…"),
        editItem,
      ];
    }

    const matchedText = match.matchedText;
    const structureBlocked = touchesStructuralSyntax(blockSlice, match.start, match.end);

    const items: ContextMenuItem[] = ContextMenuController.FORMAT_KINDS.map(({ id, label, kind }) => {
      const nested = !structureBlocked && hasSameDelimiter(matchedText, kind);
      const disabledReason = structureBlocked
        ? ContextMenuController.STRUCTURE_REASON
        : nested
          ? `This selection already contains ${label.toLowerCase()} formatting.`
          : undefined;
      return {
        id,
        label,
        enabled: !disabledReason,
        disabledReason,
        run: async () => {
          const replacement = spliceToken(blockSlice, match.start, match.end, wrapDelimiter(matchedText, kind));
          await this.commit(chapter, range, blockSlice, replacement, gen);
        },
      };
    });

    items.push({
      id: "format-link",
      label: "Make link…",
      enabled: !structureBlocked,
      disabledReason: structureBlocked ? ContextMenuController.STRUCTURE_REASON : undefined,
      run: async () => {
        const url = await this.deps.promptText({
          title: "Make link",
          label: "Web address",
          initialValue: "https://",
        });
        if (!url) return;
        const replacement = spliceToken(blockSlice, match.start, match.end, `[${matchedText}](${url})`);
        await this.commit(chapter, range, blockSlice, replacement, gen);
      },
    });

    items.push(editItem);
    return items;
  }

  private disabledFormatItem(id: string, label: string): ContextMenuItem {
    return {
      id,
      label,
      enabled: false,
      disabledReason: ContextMenuController.AMBIGUOUS_REASON,
      run: () => {},
    };
  }

  private crossBlockSelectionItems(target: ContextTarget): ContextMenuItem[] {
    const text = target.selection?.text ?? "";
    const items: ContextMenuItem[] = [
      {
        id: "selection-copy",
        label: "Copy",
        enabled: !!text,
        disabledReason: text ? undefined : "Nothing to copy.",
        run: async () => {
          if (text) await this.deps.copyToClipboard(text);
          this.close();
        },
      },
      {
        id: "selection-edit",
        label: "Edit in editor (jump to start)",
        enabled: !!(target.chapter && target.range),
        run: () => {
          if (target.chapter && target.range) this.deps.goToSource(target.chapter, target.range[0] + 1);
          this.close();
        },
      },
    ];
    return items;
  }
}

function parseWidth(attrsRaw: string): string {
  return attrsRaw.match(/width="([^"]*)"/)?.[1] ?? "";
}

function parsePosition(attrsRaw: string): string | undefined {
  return attrsRaw.match(/\.(float-left|float-right|center|full-width|full-bleed)\b/)?.[1];
}
