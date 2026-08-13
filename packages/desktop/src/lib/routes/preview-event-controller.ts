/**
 * PreviewEventController — the single owner of the PreviewClient event router
 * that used to live inline as the `onClientReady` closure in `+page.svelte`.
 *
 * It reduces over preview-frame lifecycle/navigation/source events and drives the post-render *settle
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
  userSetViewMode: boolean;
  applyViewMode(mode: "single" | "two-column", fromUser: boolean): void;
  applyFitWidthZoom(): Promise<void>;
}

/**
 * Editor↔preview sync seams for the `sourceLineChanged` branch (preview→editor
 * follow). Grouped so the editor coupling stays behind one injected surface.
 */
interface PreviewEventEditorSync {
  /** Invalidate replies issued against a preview frame/render being replaced. */
  invalidatePending: () => void;
  /** Timestamp (ms) before which preview→editor follow is suppressed (echo guard). */
  suppressPreviewSyncUntil: () => number;
  editorPaneOpen: () => boolean;
  updateActiveOutline: (line: number) => void;
  /**
   * Reveal a chapter-local line in the editor. The editor holds the whole book
   * as one document, so this is just a scroll — there is no file to open and
   * nothing to wait for, whether or not the line is in the chapter the caret
   * currently sits in.
   *
   * `deliberate` says whether the author ASKED to go there (a click) or merely
   * scrolled the preview. It decides what happens when the editor is showing
   * something that isn't the book — a stylesheet — where a chapter-local line
   * has no meaning: a deliberate jump brings the book back, a passive follow
   * leaves the author in the file they are working in.
   */
  revealEditorLine: (chapter: string | null, line: number, deliberate: boolean) => void;
  /**
   * Open (mount) the editor pane when it is closed/unmounted — lazy-loads the
   * editor module and moves focus into it. Used by `elementActivated`: a
   * click on a preview block is an explicit "go here" intent that must never
   * silently no-op just because the pane isn't open.
   */
  openEditorPane: (opts: { focus: boolean; ensureFile: boolean }) => void;
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
      case "renderingStarted":
        this.deps.editorSync.invalidatePending();
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
      // Paged.js has been removed (native-only-migration-plan.md Phase 6) —
      // native is the only engine. The rest of the old iframe-styles.ts sheet
      // targeted `.pagedjs_*` classes the native viewer's DOM never has (it
      // uses `.gp-*`, styled by decorate.ts + viewer.css); the preview
      // background is the one rule the native viewer needs injected here (it
      // is the author's preview-background setting, not engine chrome).
      client?.injectStyles("desktop-canvas", buildCanvasBackgroundStyles(d.bgColor()));
      const auto = d.viewportWidth() < 1280 ? "single" : "two-column";
      const { page: restorePage, viewMode: restoreMode } = d.consumePendingRestore();
      const mode = restoreMode ?? (d.zoomView.userSetViewMode ? d.viewMode() : auto);
      const zoom = d.zoom();
      void (async () => {
        d.zoomView.applyViewMode(mode, false);
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
    const d = this.deps;
    const es = d.editorSync;
    // Preview→editor sync: the reader scrolled. Follow in the editor and update
    // the active outline entry — but not while the editor itself is driving the
    // preview (echo guard).
    const line = detail.sourceLine;
    const chap = detail.chapter;
    if (typeof line !== "number") return;
    es.updateActiveOutline(line);
    if (d.now() < es.suppressPreviewSyncUntil() || !es.editorPaneOpen()) return;
    // The editor holds the whole book, so a scroll that crosses into another
    // chapter is not a special case: the same reveal handles it. This branch
    // used to carry a chapter-match test, a cross-chapter file-open, and a
    // dirty-buffer gate that skipped the follow entirely (so the editor stopped
    // tracking the reader mid-edit — the "sporadic" complaint). None of them
    // have anything left to guard.
    es.revealEditorLine(chap ?? null, line, false);
  }

  /**
   * `elementActivated`: the author clicked a `[data-source-line]` block in the
   * preview — an explicit "go to source" intent (PR 0 of the inline-editing
   * plan; `docs/inline-editing-plan.md`). Same reveal as `onSourceLineChanged`,
   * plus one addition: a closed/unmounted editor pane is opened rather than
   * silently dropping the click. `data-source-line` is level-0-only today, so
   * this jumps to a LINE; it cannot select the clicked block (that precision
   * arrives with the `data-source-range` primitive in a later PR — not
   * retrofitted here).
   *
   * Unlike `onSourceLineChanged`, this is not gated behind the echo-suppression
   * window (`suppressPreviewSyncUntil`) — that guard exists to swallow scroll
   * events that are themselves an echo of an editor-driven `scrollTo`, but a
   * click is always genuine author intent, never an echo.
   */
  private onElementActivated(detail: PreviewEvent["detail"]): void {
    const es = this.deps.editorSync;
    const line = detail.sourceLine;
    if (typeof line !== "number") return;

    // Explicit "go here" click: open the pane instead of no-op'ing. The reveal
    // below targets the clicked chapter itself, so the pane's own default
    // first-file pick would only race it and flash the wrong place.
    if (!es.editorPaneOpen()) es.openEditorPane({ focus: true, ensureFile: false });
    es.revealEditorLine(detail.chapter ?? null, line, true);
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
