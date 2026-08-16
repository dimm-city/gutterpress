/**
 * BlockOverlayController — single owner of the click-to-edit block overlay's
 * open/position/geometry state (inline-editing plan §5, PR 5).
 *
 * `.svelte.ts` suffix is deliberate: open/x/y/width/height/maxHeight are
 * `$state` consumed by `BlockEditOverlay.svelte`, matching
 * `ContextMenuController`'s own rationale (§4.1).
 *
 * Ownership split from `BlockEditOverlay.svelte`: this controller owns
 * geometry and the dismissal-event subscription (`renderingComplete`) — it
 * has ZERO DOM / CodeMirror awareness. The overlay opens over one thing: an
 * opaque atom in the galley's document, at a rect the frame supplied. The
 * pre-galley overlay also resolved a block by `data-source-range`, masked its
 * on-page fragments, re-anchored them across renders and zooms, and committed
 * a source splice; all of that went with the editing surface it served. The component owns the live CodeMirror view and therefore the
 * CURRENT edited text; `commit(text)`/`cancel()` are the two entry points the
 * component calls with that text (or none, for cancel) whenever a dismissal
 * source fires (Escape, blur, window blur, an opening dialog — see the
 * component's header for the full wiring).
 *
 * Host coupling (the preview client, the buffer/commitEngine seams, geometry)
 * is injected so this stays testable with fakes and PWA-clean (CLAUDE.md §8 /
 * ADR 0004): ZERO direct DOM / `node:*` / lib value imports.
 */
import type { PreviewEvent, RectsForResult } from "$lib/preview-client";
import type { CommitEngine } from "$lib/editor/commit-engine";

/** Minimal preview-client surface the controller drives. */
export interface BlockOverlayClient {
  on(fn: (e: PreviewEvent) => void): () => void;
}

export interface BlockOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BlockOverlayDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => BlockOverlayClient | undefined;
  /** The commit engine — owns the edit-generation counter the galley's
   *  whole-file saves gate on. */
  commitEngine: CommitEngine;
  /** The preview iframe's own `getBoundingClientRect()` (left/top only), or null if unmounted. */
  getIframeOrigin: () => { left: number; top: number } | null;
  /**
   * `.preview-pane`'s own rect, for clamping the overlay on-screen (plan
   * §5.1: `.preview-pane` can itself scroll, so an unclamped overlay could
   * engage that scrollbar rather than the intended internal CM scroll).
   */
  getPaneRect: () => BlockOverlayRect | null;
  /** "This section changed — reopen to edit" (plan §5.1 close-with-toast outcome). */
  toastInfo: (message: string) => void;
}

const MIN_HEIGHT = 96;
const MIN_WIDTH = 220;

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

  /**
   * Galley mode (protocol v8, docs/tiptap-galley-architecture.md): set, the
   * overlay was handed initial text + a commit callback by `showGalley()` and
   * resolves NO chapter/range of its own — commit routes the edited text to
   * this callback (which calls `galleySetOpaqueSource`; the resulting doc
   * change produces `galleyContent` → the normal save path) instead of the
   * commit engine. Null in the classic chapter/range mode.
   */
  private galleyCommit: ((text: string) => void) | null = null;
  private requestId = 0;

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
        // The generation bump closes the clean-but-DOM-stale commit window
        // for every commit path (the galley session's whole-file saves gate
        // on it). This controller owns the call outright now that the
        // context menu no longer duplicates it.
        this.deps.commitEngine.noteRenderingComplete();
        // A fresh render rebuilds the frame's document, so the ProseMirror
        // position the commit callback closes over is stale — discard rather
        // than write through a wrong pos ("fail safe, not fail wrong").
        // Typing never rebuilds (inline-edit saves suppress it), so this
        // fires only for external changes and CSS edits.
        if (this.open) this.closeWithToast();
        break;
      // pageChanged / viewportChanged used to re-fetch this block's rects by
      // {chapter, range}. The overlay is now only ever opened over an atom
      // whose rect the frame supplied, and `closeGalleyOnViewportChange()`
      // (called by the page on viewport movement) closes it rather than
      // chasing geometry that the editor itself owns.
    }
  }

  /**
   * Galley-mode entry point (protocol v8): open the overlay over an opaque
   * atom's on-screen rect, seeded with its verbatim source. The caller owns
   * what a commit MEANS (`onCommitText` → `galleySetOpaqueSource`); this
   * controller only owns geometry and the open/commit/cancel lifecycle —
   * the frame's editor already owns the block on screen.
   */
  showGalley(target: {
    /** The atom's verbatim markdown source — seeds the CM view. */
    text: string;
    /** The atom's rect in frame-viewport coordinates (converted with the
     *  iframe origin offset by `applyRects`, like the formatting bubble). */
    rect: BlockOverlayRect;
    onCommitText: (text: string) => void;
  }): void {
    this.requestId++;
    this.teardown();
    this.reset();
    this.galleyCommit = target.onCommitText;
    this.initialText = target.text;
    this.open = true;
    this.applyRects([{ ...target.rect, page: 1 }]);
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
    const galleyCommit = this.galleyCommit;
    if (!galleyCommit) return;
    this.teardown();
    this.close();
    galleyCommit(editedText);
  }

  /**
   * Release anything held while the overlay was open. The pre-galley overlay
   * masked the block's on-page fragments and had to guarantee an unmask on
   * every unmount path; the galley overlay opens over an atom the editor
   * already owns, so there is no mask to clear and this is a no-op kept as
   * the lifecycle hook `BlockEditOverlay.svelte` calls on unmount.
   */
  teardown(): void {}

  private close(): void {
    this.requestId++;
    this.reset();
  }

  /**
   * A galley-mode overlay is anchored to a rect captured at open time; a
   * scroll/zoom/page change moves the content under it. Close (discarding
   * nothing committed) rather than float over the wrong block. Classic
   * chapter/range mode re-anchors through its own geometry flow and is
   * untouched.
   */
  closeGalleyOnViewportChange(): void {
    if (this.open && this.galleyCommit) this.close();
  }

  private reset(): void {
    this.open = false;
    this.galleyCommit = null;
    this.initialText = "";
  }

  private closeWithToast(): void {
    this.deps.toastInfo("This section changed — reopen to edit.");
    this.teardown();
    this.close();
  }

  private applyRects(
    rects: RectsForResult["rects"],
    anchor?: { x: number; y: number },
  ): void {
    const pane = this.deps.getPaneRect();
    if (!rects.length || !pane) return; // keep the last-known geometry rather than jump to (0,0)
    const origin = this.deps.getIframeOrigin();
    const iframeLeft = origin?.left ?? pane.left;
    const iframeTop = origin?.top ?? pane.top;
    let first = rects[0]!;
    let bestDistance = Infinity;
    let bestArea = -1;
    for (const rect of rects) {
      const left = iframeLeft + rect.left;
      const top = iframeTop + rect.top;
      const width = Math.min(left + rect.width, pane.left + pane.width) - Math.max(left, pane.left);
      const height = Math.min(top + rect.height, pane.top + pane.height) - Math.max(top, pane.top);
      const area = width > 0 && height > 0 ? width * height : 0;
      const dx = anchor
        ? Math.max(rect.left - anchor.x, 0, anchor.x - (rect.left + rect.width))
        : 0;
      const dy = anchor
        ? Math.max(rect.top - anchor.y, 0, anchor.y - (rect.top + rect.height))
        : 0;
      const distance = anchor ? dx * dx + dy * dy : 0;
      if (distance < bestDistance || (distance === bestDistance && area > bestArea)) {
        first = rect;
        bestDistance = distance;
        bestArea = area;
      }
    }
    const baseX = iframeLeft - pane.left + first.left;
    const baseY = iframeTop - pane.top + first.top;

    const maxX = pane.width;
    const maxY = pane.height;
    const naturalWidth = Math.max(first.width, MIN_WIDTH);
    const naturalHeight = Math.max(first.height, MIN_HEIGHT);

    const x = Math.min(Math.max(baseX, 0), Math.max(0, maxX - naturalWidth));
    const y = Math.min(Math.max(baseY, 0), Math.max(0, maxY - MIN_HEIGHT));
    const maxHeight = Math.max(MIN_HEIGHT, maxY - y - 8);

    this.x = x;
    this.y = y;
    this.width = Math.min(naturalWidth, Math.max(MIN_WIDTH, pane.width - 16));
    this.height = Math.min(naturalHeight, maxHeight);
    this.maxHeight = maxHeight;
  }
}
