/**
 * EditorPreviewSyncController — the editor↔preview scroll/anchor timing machine
 * that used to live inline in `+page.svelte`.
 *
 * Sync is intentionally one-way: the editor can position the preview, while
 * ordinary preview scrolling never moves the editor. "Go to source" owns the
 * reverse direction. This controller therefore needs only a latest-request
 * guard; the former echo-suppression clock and feedback loop are gone.
 *
 * Host coupling (the preview client and page-sync sink) is injected,
 * which keeps this PWA-clean (§8 / ADR 0004): ZERO direct DOM / `node:*` / lib
 * value imports.
 *
 * Single-owner discipline mirrors `PreviewEventController`
 * (`routes/preview-event-controller.ts`), whose `sourceLineChanged` branch reads
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
}

export class EditorPreviewSyncController {
  private deps: EditorPreviewSyncDeps;

  // Only the newest editor anchor may reflect its result into toolbar state.
  // PreviewClient commands are asynchronous and can resolve out of order.
  private anchorRequestId = 0;

  constructor(deps: EditorPreviewSyncDeps) {
    this.deps = deps;
  }

  /** Invalidate asynchronous replies from a render/frame epoch that ended. */
  invalidatePending(): void {
    this.anchorRequestId++;
  }

  /**
   * Editor→preview: the caret moved or the editor scrolled. Drive the preview
   * to the matching source line.
   *
   * `chapter` is the project-relative path of the one displayed editor file.
   */
  onEditorAnchorLine(
    line: number,
    origin: "scroll" | "caret",
    chapter: string | null,
  ): void {
    const requestId = ++this.anchorRequestId;
    const client = this.deps.client();
    if (!client || this.deps.rendering()) return;
    // Scroll-driven anchors are the editor's TOP visible line → anchor the
    // preview block to the TOP so the panes agree. Caret-driven anchors carry
    // no viewport position (the caret sits anywhere), so CENTER the target —
    // top-anchoring it disagreed with the editor by the caret's distance from
    // the editor top (QA finding RC1-5).
    client
      .scrollTo({ line, chapter }, { block: origin === "caret" ? "center" : "start" })
      .then((res) => {
        if (requestId !== this.anchorRequestId || this.deps.rendering()) return;
        // scrollTo suppresses the book's scroll-driven pageChanged, so reflect
        // the new page in the toolbar from the command's own return value.
        if (res?.page) this.deps.syncPageAfterScroll(res.page);
      })
      .catch(() => {});
  }
}
