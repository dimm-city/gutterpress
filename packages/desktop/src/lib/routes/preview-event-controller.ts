/**
 * PreviewEventController — the single owner of the PreviewClient event router
 * that used to live inline as the `onClientReady` closure in `+page.svelte`.
 *
 * It reduces over preview-frame lifecycle/navigation/source events and drives the post-render *settle
 * sequence*: pushing the derived view mode into the fresh frame, the
 * fit-width-vs-numeric-zoom reveal race, page restore, outline rebuild, and
 * re-lint.
 *
 * The ordering of that settle sequence is load-bearing — it is what prevents
 * the visible page JUMP. The pages stay invisible (iframe opacity 0) through
 * the view-mode switch AND the async zoom round-trips; only once the zoom has
 * actually applied (the promise resolving in a `finally`, never a timer) do we
 * cross-fade via `revealSettledPages`, so the fade always uncovers a completely
 * still layout. Do not reorder these steps.
 *
 * Host coupling is injected (mirroring `PageNavController` /
 * `ZoomViewController`) so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the live preview client, the composed page-nav / zoom-view
 * controllers, the render-phase state sinks, the editor-sync seams, and the
 * toast / outline / lint callbacks. ZERO direct DOM / `node:*` / lib
 * value imports — the one lib touch is the pure `$lib/iframe-styles` CSS
 * builders (browser-safe string templates).
 */

import { buildCanvasBackgroundStyles } from "$lib/iframe-styles";
import type { PreviewEvent } from "$lib/preview-client";

/** Minimal host-command client surface the controller drives. */
interface PreviewEventClient {
  call<T = unknown>(cmd: string, args?: unknown[]): Promise<T>;
  injectStyles(id: string, css: string): void;
}

/** Composed PageNavController surface (the bits this router touches). */
interface PreviewEventPageNav {
  totalPages: number;
  restoreProjectPage(page: number): void;
  syncPageState(detail: { currentPage?: number; totalPages?: number }): void;
}

/** Composed ZoomViewController surface (the bits this router touches). */
interface PreviewEventZoomView {
  applyViewMode(mode: "single" | "two-column"): void;
  applyFitWidthZoom(): Promise<void>;
}

/**
 * Editor/outline seams: render replacement invalidates pending editor→preview
 * commands, while preview scrolling updates outline chrome only.
 */
interface PreviewEventEditorSync {
  /** Invalidate replies issued against a preview frame/render being replaced. */
  invalidatePending: () => void;
  updateActiveOutline: (line: number) => void;
  /**
   * Bring one source line into an ALREADY-OPEN editor. The host decides
   * whether an editor is open at all — a click never opens the pane.
   */
  revealEditorLine: (chapter: string | null, line: number) => void;
}

export interface PreviewEventDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => PreviewEventClient | undefined;
  pageNav: PreviewEventPageNav;
  zoomView: PreviewEventZoomView;
  editorSync: PreviewEventEditorSync;
  // ── Durable settings accessors ──────────────────────────────────────────
  zoom: () => string;
  viewMode: () => "single" | "two-column";
  bgColor: () => string;
  // ── Render-phase state sinks / getters ──────────────────────────────────
  setRendering: (v: boolean) => void;
  getRendering: () => boolean;
  setRenderProgressPage: (v: number) => void;
  getRenderProgressPage: () => number;
  setRenderCompleteOverlay: (v: boolean) => void;
  /** Tiny non-blocking status shown only for save-triggered replacement frames. */
  setPreviewUpdating: (v: boolean) => void;
  /** Clear the outline + reset the active index (on a new render starting). */
  resetOutline: () => void;
  /** Read-and-clear the pending per-project page restore. */
  consumePendingRestore: () => { page: number | null };
  // ── Side effects ─────────────────────────────────────────────────────────
  refreshOutline: () => void;
  refreshProblems: () => void;
  /** Cross-fade the settled pages into view (one animation frame; no timers). */
  revealSettledPages: () => void;
  toastSuccess: (message: string) => void;
  // ── Environment / clock ──────────────────────────────────────────────────
  scheduleMicrotask: (fn: () => void) => void;
}

export class PreviewEventController {
  private deps: PreviewEventDeps;
  // First-render-only success-toast gate (M3). `renderingComplete` fires for
  // BOTH the initial render of a project AND every watcher-triggered rebuild
  // (the 500ms auto-save debounce), so toasting unconditionally stacks
  // "Your book is ready — N pages" toasts nearly permanently on screen while
  // the author types. Later rebuilds stay ambient (ProblemsPanel/page count
  // in existing chrome); only the first render of a session gets the toast.
  private toastedThisSession = false;

  constructor(deps: PreviewEventDeps) {
    this.deps = deps;
  }

  /**
   * Re-arm the first-render toast gate. Call when a new project/document
   * session begins (a folder is opened, reopened, or the active book is
   * switched) so that session's first render still gets the confirmation
   * toast.
   */
  resetFirstRenderGate(): void {
    this.toastedThisSession = false;
  }

  /**
   * Subscribe to a preview client's event stream. Returns the unsubscribe fn.
   * Cleanup is otherwise handled when the client is replaced (PreviewFrame
   * remounts on previewUrl change).
   */
  subscribe(client: { on(fn: (e: PreviewEvent) => void): () => void }): () => void {
    return client.on((e) => this.handleEvent(e));
  }

  handleEvent(e: PreviewEvent): void {
    switch (e.name) {
      case "renderingStarted":
        this.deps.editorSync.invalidatePending();
        this.deps.setPreviewUpdating(true);
        break;
      case "renderingCancelled":
        this.deps.setPreviewUpdating(false);
        // A cancel says this render will not complete, and `renderingComplete`
        // is the only other thing that clears the BLOCKING scrim — so leaving
        // `rendering` set strands the author under a permanent "Rendering…"
        // overlay waiting on an event that is never coming. The overlay's own
        // Cancel button (`handleCancelRender`) already clears both flags; this
        // is the same decision arriving from the frame instead of the mouse.
        this.deps.setRendering(false);
        this.deps.setRenderCompleteOverlay(false);
        break;
      case "renderingComplete":
        this.onRenderingComplete(e.detail);
        break;
      case "sourceLineChanged":
        this.onSourceLineChanged(e.detail);
        break;
      case "elementActivated":
        this.onElementActivated(e.detail);
        break;
      case "pageChanged":
        this.onPageChanged(e.detail);
        break;
      case "ready":
        this.onReady();
        break;
    }
  }

  private onRenderingComplete(detail: PreviewEvent["detail"]): void {
    const d = this.deps;
    const hotReload = detail.hotReload === true;
    // Any completion ends an in-flight reload: a non-hot-reload completion
    // means the whole frame re-rendered, so the reload it would have replaced
    // is over either way.
    d.setPreviewUpdating(false);
    const n = detail.totalPages ?? 0;
    d.pageNav.totalPages = n;
    d.setRenderProgressPage(n);
    d.setRendering(false);
    // Keep the translucent overlay up while the post-render layout settles. The
    // iframe itself stays visible at opacity 1 (hiding it triggers Chromium's
    // cross-origin throttle); revealSettledPages() fades only the overlay after
    // the async zoom round-trip has stopped moving the layout.
    d.setRenderCompleteOverlay(!hotReload);
    // The shell copies settled presentation into a hot replacement before
    // reveal. Reapplying styles/view/zoom here would add another visible reflow
    // and unnecessary settings writes.
    if (!hotReload) {
      const client = d.client();
      // The viewer styles its own chrome (decorate.ts + viewer.css). The
      // preview background is the one rule it needs injected here, because it
      // is the author's preview-background setting, not engine chrome.
      client?.injectStyles("desktop-canvas", buildCanvasBackgroundStyles(d.bgColor()));
      const { page: restorePage } = d.consumePendingRestore();
      const zoom = d.zoom();
      void (async () => {
        d.zoomView.applyViewMode(d.viewMode());
        try {
          if (zoom === "fit-width") {
            await d.zoomView.applyFitWidthZoom();
          } else {
            await client?.call("setZoom", [Number(zoom)]);
          }
        } catch {
          // Zoom failed; still dismiss the overlay below.
        } finally {
          d.revealSettledPages();
        }
      })();
      if (restorePage && restorePage > 1) {
        d.scheduleMicrotask(() => d.pageNav.restoreProjectPage(restorePage));
      }
    }
    // UX-011: improved success toast copy. M3: only the FIRST render of a
    // session toasts — later watcher-triggered rebuilds stay ambient.
    if (!this.toastedThisSession) {
      this.toastedThisSession = true;
      d.toastSuccess(`Your book is ready — ${n} ${n === 1 ? "page" : "pages"}`);
    }
    // Build the chapter-jump outline from the freshly rendered DOM.
    d.refreshOutline();
    // Re-lint the project on every rebuild so the Problems panel tracks the
    // author's edits (#28).
    d.refreshProblems();
  }

  private onSourceLineChanged(detail: PreviewEvent["detail"]): void {
    // Preview scrolling updates navigation chrome only. It must never move the
    // editor's viewport/caret: that feedback loop was the source of delayed
    // editor jumps after a hot reload. "Go to source" is the single explicit
    // preview→editor navigation action.
    const line = detail.sourceLine;
    if (typeof line !== "number") return;
    this.deps.editorSync.updateActiveOutline(line);
  }

  /**
   * The author clicked a source-mapped block in the book. Bring that block's
   * source into the editor and scroll to it.
   *
   * This is a CLICK, not scrolling: `sourceLineChanged` above stays chrome-only
   * precisely because a scroll-driven editor jump is a feedback loop, but a
   * deliberate click carries the author's intent to work on that block. The
   * host's `revealEditorLine` is a no-op unless the editor pane is already
   * open, so clicking around a book in viewer mode still opens nothing.
   */
  private onElementActivated(detail: PreviewEvent["detail"]): void {
    const line = detail.sourceLine;
    if (typeof line !== "number") return;
    this.deps.editorSync.revealEditorLine(detail.chapter ?? null, line);
  }

  private onPageChanged(detail: PreviewEvent["detail"]): void {
    const d = this.deps;
    if (d.getRendering()) {
      d.setRenderProgressPage(detail.totalPages ?? d.getRenderProgressPage());
      d.pageNav.totalPages = detail.totalPages ?? d.pageNav.totalPages;
    } else {
      d.pageNav.syncPageState(detail);
    }
  }

  private onReady(): void {
    const d = this.deps;
    d.editorSync.invalidatePending();
    d.setRendering(true);
    // New render starting — overlay covers the layout shuffle; fades out on
    // renderingComplete.
    d.setRenderProgressPage(0);
    d.resetOutline();
    d.client()
      ?.call<number>("getTotalPages")
      .then((count) => {
        if (count > 0) d.pageNav.totalPages = count;
      })
      .catch(() => {});
  }
}
