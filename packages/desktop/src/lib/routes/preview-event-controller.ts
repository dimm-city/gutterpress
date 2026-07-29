/**
 * PreviewEventController — the single owner of the PreviewClient event router
 * that used to live inline as the `onClientReady` closure in `+page.svelte`.
 *
 * It reduces over the four preview-frame events (`renderingComplete`, `ready`,
 * `pageChanged`, `sourceLineChanged`) and drives the post-render *settle
 * sequence*: view-mode auto-selection, the fit-width-vs-numeric-zoom reveal
 * race, page restore, outline rebuild, and re-lint.
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

import { buildDesktopStyles, DEBUG_STYLES } from "$lib/iframe-styles";
import type { PreviewEvent } from "$lib/preview-client";

/** Minimal host-command client surface the controller drives. */
export interface PreviewEventClient {
  call<T = unknown>(cmd: string, args?: unknown[]): Promise<T>;
  injectStyles(id: string, css: string): void;
}

/** Composed PageNavController surface (the bits this router touches). */
export interface PreviewEventPageNav {
  totalPages: number;
  restoreProjectPage(page: number): void;
  syncPageState(detail: { currentPage?: number; totalPages?: number }): void;
}

/** Composed ZoomViewController surface (the bits this router touches). */
export interface PreviewEventZoomView {
  userSetViewMode: boolean;
  applyViewMode(mode: "single" | "two-column", fromUser: boolean): void;
  applyFitWidthZoom(): Promise<void>;
}

/**
 * Editor↔preview sync seams for the `sourceLineChanged` branch (preview→editor
 * follow). Grouped so the editor coupling stays behind one injected surface.
 */
export interface PreviewEventEditorSync {
  /** Timestamp (ms) before which preview→editor follow is suppressed (echo guard). */
  suppressPreviewSyncUntil: () => number;
  editorPaneOpen: () => boolean;
  editorChapter: () => string | null;
  currentDir: () => string | null;
  /** Whether the open editor buffer has unsaved edits. */
  bufferDirty: () => boolean;
  updateActiveOutline: (line: number) => void;
  /** Reveal a line in the currently-open chapter (no-op if no editor). */
  revealEditorLine: (line: number) => void;
  /** Open a different chapter's file and reveal the line once it loads. */
  followChapterInEditor: (chapter: string, line: number) => void;
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
  /** Clear the outline + reset the active index (on a new render starting). */
  resetOutline: () => void;
  /** Read-and-clear the pending per-project restore (page + view mode). */
  consumePendingRestore: () => {
    page: number | null;
    viewMode: "single" | "two-column" | null;
  };
  // ── Side effects ─────────────────────────────────────────────────────────
  refreshOutline: () => void;
  refreshProblems: () => void;
  /** Cross-fade the settled pages into view (one animation frame; no timers). */
  revealSettledPages: () => void;
  toastSuccess: (message: string) => void;
  // ── Environment / clock ──────────────────────────────────────────────────
  viewportWidth: () => number;
  now: () => number;
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
      case "renderingComplete":
        this.onRenderingComplete(e.detail);
        break;
      case "sourceLineChanged":
        this.onSourceLineChanged(e.detail);
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
    const n = detail.totalPages ?? 0;
    d.pageNav.totalPages = n;
    d.setRenderProgressPage(n);
    d.setRendering(false);
    // Keep the overlay up while the post-render layout settles. The pages stay
    // invisible (iframe opacity 0) through the view-mode switch AND the async
    // zoom round-trips; only once the zoom is actually applied do we cross-fade
    // — see the revealSettledPages() call at the end of the settle sequence
    // below. This is what prevents the visible page JUMP: we never reveal
    // before the layout has stopped moving.
    d.setRenderCompleteOverlay(true);
    // Inject canvas styles now that Paged.js is done.
    const client = d.client();
    client?.injectStyles("desktop-canvas", buildDesktopStyles(d.bgColor()));
    client?.injectStyles("debug", DEBUG_STYLES);
    // Set initial view mode (auto if the user hasn't chosen).
    const auto = d.viewportWidth() < 1280 ? "single" : "two-column";
    const { page: restorePage, viewMode: restoreMode } = d.consumePendingRestore();
    const mode = restoreMode ?? (d.zoomView.userSetViewMode ? d.viewMode() : auto);
    const zoom = d.zoom();
    // Drive the whole settle sequence to completion, THEN reveal. The reveal is
    // gated on the zoom promise resolving — not a magic timer — so the fade
    // always uncovers a completely still layout. Reveal is in a finally so the
    // pages are never stranded invisible if a zoom call rejects.
    void (async () => {
      d.zoomView.applyViewMode(mode, false);
      try {
        // "Fit to width" must ALWAYS measure-and-fit, never assume 100% fits.
        // A two-page spread (~1656px) overflows a 1400px pane at 100%, clipping
        // the right page — so fit even on wide screens. Awaiting
        // applyFitWidthZoom() waits for both postMessage round-trips
        // (getPageDimensions + setZoom), i.e. until the JUMP has happened.
        if (zoom === "fit-width") {
          await d.zoomView.applyFitWidthZoom();
        } else {
          await client?.call("setZoom", [Number(zoom)]);
        }
      } catch {
        // Zoom failed — still reveal below so pages aren't stranded hidden.
      } finally {
        d.revealSettledPages();
      }
    })();
    if (restorePage && restorePage > 1) {
      d.scheduleMicrotask(() => d.pageNav.restoreProjectPage(restorePage));
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
    const d = this.deps;
    const es = d.editorSync;
    // Preview→editor sync: the reader scrolled. Follow in the editor and update
    // the active outline entry — but not while the editor itself is driving the
    // preview (echo guard).
    const line = detail.sourceLine;
    const chap = detail.chapter;
    if (typeof line === "number") {
      es.updateActiveOutline(line);
      if (d.now() >= es.suppressPreviewSyncUntil() && es.editorPaneOpen()) {
        if (chap === es.editorChapter()) {
          es.revealEditorLine(line);
        } else if (chap && es.currentDir() && !es.bufferDirty()) {
          // Scrolled into a DIFFERENT chapter: follow it by opening that
          // chapter's file, then reveal the line once it has loaded. Skipped
          // when there are unsaved edits so it never yanks the file away mid-
          // edit. This is what makes the editor track the whole book, not just
          // the one open chapter (the "sporadic" complaint).
          es.followChapterInEditor(chap, line);
        }
      }
    }
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
