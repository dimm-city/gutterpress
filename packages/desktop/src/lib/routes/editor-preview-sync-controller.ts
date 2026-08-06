/**
 * EditorPreviewSyncController — the editor↔preview scroll/anchor timing machine
 * that used to live inline in `+page.svelte`.
 *
 * ## What used to be here
 *
 * The editor held ONE chapter file while the preview rendered the whole book,
 * so following the preview across a chapter boundary meant opening a different
 * file: a `setTimeout` poll loop waiting for the async buffer swap, a nudge
 * counter re-issuing the reveal five times because the load reset scroll to the
 * top, retry bookkeeping capped at ~2s, and a dirty-buffer gate so none of it
 * fired mid-edit. All of that is gone. The editor now holds the WHOLE BOOK as
 * one document (`$lib/editor/book-layout.ts`), so the target line is already on
 * screen — `revealEditorLine(chapter, line)` is the entire follow.
 *
 * ## What is left
 *
 * One thing that genuinely needs state: the echo-suppression window. Driving
 * either pane makes it emit the scroll event the other pane would follow, so a
 * timestamp guard marks the interval during which an incoming
 * `sourceLineChanged` is our own echo rather than a reader scrolling.
 *
 * The clock (`now`) is INJECTED so the guard is deterministic in tests, as is
 * host coupling (the preview client, the editor accessor, the page-sync sink),
 * which keeps this PWA-clean (§8 / ADR 0004): ZERO direct DOM / `node:*` / lib
 * value imports.
 *
 * Single-owner discipline mirrors `PreviewEventController`
 * (`routes/preview-event-controller.ts`), whose `sourceLineChanged` branch reads
 * `suppressPreviewSyncUntil` before following.
 */

/** Minimal preview-client surface the sync machine drives. */
export interface EditorPreviewSyncClient {
  scrollTo(
    target: { line: number; chapter?: string | null },
    opts?: { block?: "start" | "center"; smooth?: boolean },
  ): Promise<{ page: number; sourceLine: number | null } | null>;
}

export interface EditorPreviewSyncDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => EditorPreviewSyncClient | undefined;
  /** True while a render is in flight (anchor follow is suppressed). */
  rendering: () => boolean;
  /** Reflect a scroll-driven page into the toolbar (pageNav.syncPageState). */
  syncPageAfterScroll: (page: number) => void;
  /** Injected clock (ms). */
  now: () => number;
}

export class EditorPreviewSyncController {
  private deps: EditorPreviewSyncDeps;

  // Timestamp guard: while the preview is being driven from the editor side,
  // ignore the sourceLineChanged it emits so the two panes don't feed back.
  private suppressUntil = 0;

  constructor(deps: EditorPreviewSyncDeps) {
    this.deps = deps;
  }

  /** Timestamp (ms) before which preview→editor follow is suppressed (echo guard). */
  get suppressPreviewSyncUntil(): number {
    return this.suppressUntil;
  }

  /** Open the echo-suppression window for `ms` from now. */
  suppressFor(ms: number): void {
    this.suppressUntil = this.deps.now() + ms;
  }

  /**
   * Editor→preview: the caret moved or the editor scrolled. Drive the preview
   * to the matching source line; guard the echo so the preview's resulting
   * sourceLineChanged doesn't bounce back into the editor.
   *
   * `chapter` comes from the editor itself — it is whichever chapter of the
   * book document that line fell in — so a scroll that crosses a chapter
   * boundary needs no special case at all.
   */
  onEditorAnchorLine(
    line: number,
    origin: "scroll" | "caret",
    chapter: string | null,
  ): void {
    const client = this.deps.client();
    if (!client || this.deps.rendering()) return;
    this.suppressUntil = this.deps.now() + 400;
    // Scroll-driven anchors are the editor's TOP visible line → anchor the
    // preview block to the TOP so the panes agree. Caret-driven anchors carry
    // no viewport position (the caret sits anywhere), so CENTER the target —
    // top-anchoring it disagreed with the editor by the caret's distance from
    // the editor top (QA finding RC1-5).
    client
      .scrollTo({ line, chapter }, { block: origin === "caret" ? "center" : "start" })
      .then((res) => {
        // scrollTo suppresses the book's scroll-driven pageChanged, so reflect
        // the new page in the toolbar from the command's own return value.
        if (res?.page) this.deps.syncPageAfterScroll(res.page);
      })
      .catch(() => {});
  }
}
