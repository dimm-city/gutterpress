/**
 * BlockOverlayController — single owner of the click-to-edit block overlay's
 * open/position/geometry state (inline-editing plan §5, PR 5).
 *
 * `.svelte.ts` suffix is deliberate: open/x/y/width/height/maxHeight are
 * `$state` consumed by `BlockEditOverlay.svelte`, matching
 * `ContextMenuController`'s own rationale (§4.1).
 *
 * Ownership split from `BlockEditOverlay.svelte`: this controller owns
 * geometry, the captured-at-open patch context (chapter/range/expected/
 * trailingBlank/generation/ref), the bridge calls (`getRectsFor`/
 * `setEditMask`), and the dismissal-event subscription
 * (`renderingComplete`/`pageChanged`) — it has ZERO DOM / CodeMirror
 * awareness. The component owns the live CodeMirror view and therefore the
 * CURRENT edited text; `commit(text)`/`cancel()` are the two entry points the
 * component calls with that text (or none, for cancel) whenever a dismissal
 * source fires (Escape, blur, window blur, an opening dialog — see the
 * component's header for the full wiring).
 *
 * Host coupling (the preview client, the buffer/commitEngine seams, geometry)
 * is injected so this stays testable with fakes and PWA-clean (CLAUDE.md §8 /
 * ADR 0004): ZERO direct DOM / `node:*` / lib value imports.
 */
import type { PreviewEvent, SourceRange, RectsForResult } from "$lib/preview-client";
import type { CommitEngine } from "$lib/editor/commit-engine";
import { chapterPath } from "$lib/editor/chapter-path";
import { buildLineStarts, charRange } from "$lib/editor/source-range";

/** Minimal preview-client surface the controller drives. */
export interface BlockOverlayClient {
  on(fn: (e: PreviewEvent) => void): () => void;
  getRectsFor(target: { ref: string } | { chapter: string; range: SourceRange }): Promise<RectsForResult>;
  setEditMask(spec: { ref: string; masked: boolean }): Promise<{ count: number }>;
}

/** The live editor buffer's minimal surface the controller peeks at (never mutates). */
export interface BlockOverlayBuffer {
  filePath: string | null;
  content: string;
}

export interface BlockOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The target the "Edit this block" menu item hands off (context-menu-controller.svelte.ts). */
export interface BlockOverlayTarget {
  chapter: string;
  range: SourceRange;
  ref: string | null;
}

export interface BlockOverlayDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => BlockOverlayClient | undefined;
  /** The open project directory, or null when none is loaded. */
  currentDir: () => string | null;
  /** The live editor buffer, or null before it has been constructed. */
  buffer: () => BlockOverlayBuffer | null;
  /**
   * Read a chapter's file DIRECTLY — NOT through `selectEditorFile`, mirroring
   * `ContextMenuController.readChapterSource` (§4.4's "never disturb which
   * file the editor pane shows just to open the overlay" discipline).
   */
  readFile: (path: string) => Promise<string>;
  /** The commit engine — owns the write path AND the edit-generation counter. */
  commitEngine: CommitEngine;
  /** The preview iframe's own `getBoundingClientRect()` (left/top only), or null if unmounted. */
  getIframeOrigin: () => { left: number; top: number } | null;
  /**
   * `.preview-pane`'s own rect, for clamping the overlay on-screen (plan
   * §5.1: `.preview-pane` can itself scroll, so an unclamped overlay could
   * engage that scrollbar rather than the intended internal CM scroll).
   */
  getPaneRect: () => BlockOverlayRect | null;
  toastError: (message: string) => void;
  /** "This section changed — reopen to edit" (plan §5.1 close-with-toast outcome). */
  toastInfo: (message: string) => void;
}

const MIN_HEIGHT = 96;
const MIN_WIDTH = 220;

/**
 * Split a captured block slice's trailing NEWLINE-ONLY run into `{editable,
 * trailingBlank}` (plan §5.5 boundary rules).
 *
 * A run of `k` consecutive trailing newline tokens corresponds to the last
 * content line's own required line terminator (1 token) plus `k - 1` blank
 * lines after it. Only the blank-line tokens are stripped — the block's own
 * last line (its text AND its own terminator, if any) is always left intact
 * in `editable`, so a fence's closing line (non-blank — it's backticks, not
 * whitespace) is never touched, and a block with no trailing newline at all
 * (last block in a file) strips nothing.
 *
 * `trailingBlank` is re-appended VERBATIM on commit — this is what prevents
 * an author from merging two blocks by deleting the terminal newline.
 */
export function splitTrailingBlankRun(slice: string): { editable: string; trailingBlank: string } {
  const runMatch = slice.match(/(?:\r\n?|\n)+$/);
  if (!runMatch) return { editable: slice, trailingBlank: "" };
  const run = runMatch[0];
  const runStart = slice.length - run.length;
  const tokens = run.match(/\r\n?|\n/g) ?? [];
  if (tokens.length <= 1) return { editable: slice, trailingBlank: "" };
  const keep = tokens[0]!;
  const trailingBlank = tokens.slice(1).join("");
  return { editable: slice.slice(0, runStart) + keep, trailingBlank };
}

interface Captured {
  chapter: string;
  range: SourceRange;
  /** The FULL slice (including the trailing blank run) captured at open time — this is `commitRangePatch`'s `expected`. */
  expected: string;
  trailingBlank: string;
  expectedGeneration: number;
  ref: string | null;
}

export class BlockOverlayController {
  private deps: BlockOverlayDeps;

  // ── Public rune state (read by BlockEditOverlay.svelte) ────────────────────
  open = $state(false);
  x = $state(0);
  y = $state(0);
  width = $state(320);
  height = $state(160);
  maxHeight = $state(320);
  /** The block's SOURCE MARKDOWN (buffer slice), trailing blank run stripped — seeds the CM view on mount. Read once at mount; not updated by a later re-anchor. */
  initialText = $state("");

  private captured: Captured | null = null;

  constructor(deps: BlockOverlayDeps) {
    this.deps = deps;
  }

  /** Subscribe to a preview client's event stream. Returns the unsubscribe fn. */
  subscribe(client: BlockOverlayClient): () => void {
    return client.on((e) => void this.handleEvent(e));
  }

  private async handleEvent(e: PreviewEvent): Promise<void> {
    switch (e.name) {
      case "renderingComplete":
        // Bumping the generation here too (alongside ContextMenuController's
        // own identical call) double-increments `gen` on a single render
        // when both controllers are live — harmless: the commit gate is a
        // NOT-EQUAL check against a captured snapshot, so any nonzero delta
        // invalidates a stale capture identically to a delta of exactly one.
        // Keeping the call here (rather than relying on the sibling
        // controller) keeps this controller correct standalone, e.g. under
        // test with no ContextMenuController present at all.
        this.deps.commitEngine.noteRenderingComplete();
        await this.reanchorAfterRender();
        break;
      case "pageChanged":
        // Zoom / view-mode / page-nav all route through the bridge's
        // notifyPageChange() (pagedjs-interface.js), so this ONE case covers
        // all three anchor-invalidating cases the plan lists separately.
        await this.reanchorAfterViewportChange();
        break;
    }
  }

  /** Entry point: the context menu's "Edit this block" item. */
  async show(target: BlockOverlayTarget): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir) return;
    const source = await this.readChapterSource(target.chapter);
    if (source == null) {
      this.deps.toastError("Couldn't read this chapter's source.");
      return;
    }
    let from: number;
    let to: number;
    try {
      const starts = buildLineStarts(source);
      [from, to] = charRange(source, starts, target.range);
    } catch {
      this.deps.toastError("Couldn't locate this block in the source.");
      return;
    }
    const slice = source.slice(from, to);
    const { editable, trailingBlank } = splitTrailingBlankRun(slice);

    this.captured = {
      chapter: target.chapter,
      range: target.range,
      expected: slice,
      trailingBlank,
      expectedGeneration: this.deps.commitEngine.generation,
      ref: target.ref,
    };
    this.initialText = editable;
    this.open = true;

    const client = this.deps.client();
    if (!client) {
      // No live client (locked / URL-preview mode) — still let the overlay
      // open with a fallback position; there is nothing to mask.
      return;
    }
    let result: RectsForResult;
    try {
      result = target.ref
        ? await client.getRectsFor({ ref: target.ref })
        : await client.getRectsFor({ chapter: target.chapter, range: target.range });
    } catch {
      result = { ref: null, rects: [] };
    }
    if (!this.open || this.captured?.chapter !== target.chapter) return; // closed/reopened while awaiting
    if (!result.rects.length) {
      this.deps.toastError("Couldn't locate this block on the page.");
      this.close();
      return;
    }
    this.captured.ref = result.ref ?? target.ref;
    this.applyRects(result.rects);
    if (this.captured.ref) void client.setEditMask({ ref: this.captured.ref, masked: true });
  }

  /** Discard the in-progress edit (Escape). */
  cancel(): void {
    this.teardown();
    this.close();
  }

  /**
   * Commit the CURRENT editor text (blur / Ctrl-Enter / window blur / opening
   * a dialog). `duringComposition: true` is the IME guard (plan §5.6): some
   * IME candidate-window interactions transiently blur the CodeMirror DOM
   * node mid-composition — the component tracks `compositionstart`/
   * `compositionend` and passes this through rather than committing (and
   * losing) an in-progress, not-yet-finalized composition.
   */
  async commit(editedText: string, opts: { duringComposition?: boolean } = {}): Promise<void> {
    if (opts.duringComposition) return;
    const captured = this.captured;
    if (!captured) return;
    const replacement = editedText + captured.trailingBlank;
    this.teardown();
    this.close();
    const outcome = await this.deps.commitEngine.commitRangePatch({
      chapter: captured.chapter,
      range: captured.range,
      expected: captured.expected,
      replacement,
      expectedGeneration: captured.expectedGeneration,
    });
    if (!outcome.ok) this.deps.toastError(outcome.message);
  }

  /**
   * Defense-in-depth (plan §5.1/§5.6): ALWAYS issues `setEditMask({masked:
   * false})` for whatever ref is currently captured. `commit()`/`cancel()`
   * already call this; `BlockEditOverlay.svelte`'s `onMount` cleanup calls it
   * again unconditionally on EVERY unmount path, including ones that skip
   * `commit()`/`cancel()` entirely (a project switch, an error unmount) — the
   * "the iframe reload clears masks anyway" argument only covers a
   * splice/swap, not SPA-side teardown. Idempotent: removing a class that
   * isn't there, or unmasking a ref with zero live fragments, is a no-op.
   */
  teardown(): void {
    const ref = this.captured?.ref;
    const client = this.deps.client();
    if (ref && client) void client.setEditMask({ ref, masked: false }).catch(() => {});
  }

  private close(): void {
    this.open = false;
    this.captured = null;
    this.initialText = "";
  }

  // ── Re-anchoring (plan §5.1) ─────────────────────────────────────────────

  /**
   * `renderingComplete`: a chapter splice just replaced the DOM (our own
   * commit already closed the overlay by the time this fires; an EXTERNAL
   * change — another save, a watcher reload — may still be open). Fresh DOM
   * means fresh `data-ref`s, so this MUST use the `{chapter, range}`
   * fallback, never the stale `ref`. If the block no longer resolves (edited
   * away / merged), the in-progress edit is discarded and the overlay closes
   * with a toast — plan §1 principle 3 ("fail safe, not fail wrong"): once
   * the underlying content can no longer be verified to be what's on screen,
   * silently continuing to edit it is not safe, even though the commit
   * engine's own mismatch gate would ALSO catch this at commit time.
   */
  private async reanchorAfterRender(): Promise<void> {
    if (!this.open || !this.captured) return;
    const client = this.deps.client();
    const { chapter, range } = this.captured;
    if (!client) {
      this.closeWithToast();
      return;
    }
    let result: RectsForResult;
    try {
      result = await client.getRectsFor({ chapter, range });
    } catch {
      result = { ref: null, rects: [] };
    }
    if (!this.open || this.captured?.chapter !== chapter) return; // closed while awaiting
    if (!result.rects.length) {
      this.closeWithToast();
      return;
    }
    const oldRef = this.captured.ref;
    const newRef = result.ref;
    this.captured.ref = newRef;
    this.applyRects(result.rects);
    if (newRef) void client.setEditMask({ ref: newRef, masked: true });
    if (oldRef && oldRef !== newRef) void client.setEditMask({ ref: oldRef, masked: false }).catch(() => {});
  }

  /**
   * `pageChanged` (zoom / view-mode / page nav): the DOM itself did not
   * change, only layout — the captured `ref` is still valid, so this re-fetch
   * uses the FAST `{ref}` path, purely to refresh geometry.
   */
  private async reanchorAfterViewportChange(): Promise<void> {
    if (!this.open || !this.captured?.ref) return;
    const client = this.deps.client();
    if (!client) return;
    const ref = this.captured.ref;
    let result: RectsForResult;
    try {
      result = await client.getRectsFor({ ref });
    } catch {
      return;
    }
    if (!this.open || this.captured?.ref !== ref) return;
    if (result.rects.length) this.applyRects(result.rects);
  }

  private closeWithToast(): void {
    this.deps.toastInfo("This section changed — reopen to edit.");
    this.teardown();
    this.close();
  }

  // ── Chapter source (mirrors ContextMenuController.readChapterSource) ───────

  private async readChapterSource(chapter: string): Promise<string | null> {
    const dir = this.deps.currentDir();
    if (!dir) return null;
    const absPath = chapterPath(dir, chapter);
    const buf = this.deps.buffer();
    if (buf && buf.filePath === absPath) return buf.content;
    try {
      return await this.deps.readFile(absPath);
    } catch {
      return null;
    }
  }

  // ── Geometry (plan §5.1) ────────────────────────────────────────────────

  /**
   * Position/size the overlay from the block's FIRST fragment rect, clamped
   * fully inside `.preview-pane` (never flipped — unlike the point-anchored
   * context menu, this overlay is anchored to sit ON the block itself, so
   * flipping it to the opposite side of the anchor point would put it over
   * unrelated content; clamping is what actually matters for staying
   * on-screen). Height is capped to the visible pane with the difference left
   * to the component's own internal CM scroll (a split block can span 9+
   * pages, plan §5.1).
   */
  private applyRects(rects: RectsForResult["rects"]): void {
    const first = rects[0];
    const pane = this.deps.getPaneRect();
    if (!first || !pane) return; // keep the last-known geometry rather than jump to (0,0)
    const origin = this.deps.getIframeOrigin();
    const baseX = (origin?.left ?? 0) + first.left;
    const baseY = (origin?.top ?? 0) + first.top;

    const maxX = pane.left + pane.width;
    const maxY = pane.top + pane.height;
    const naturalWidth = Math.max(first.width, MIN_WIDTH);
    const naturalHeight = Math.max(first.height, MIN_HEIGHT);

    const x = Math.min(Math.max(baseX, pane.left), Math.max(pane.left, maxX - naturalWidth));
    const y = Math.min(Math.max(baseY, pane.top), Math.max(pane.top, maxY - MIN_HEIGHT));
    const maxHeight = Math.max(MIN_HEIGHT, maxY - y - 8);

    this.x = x;
    this.y = y;
    this.width = Math.min(naturalWidth, Math.max(MIN_WIDTH, pane.width - 16));
    this.height = Math.min(naturalHeight, maxHeight);
    this.maxHeight = maxHeight;
  }
}
