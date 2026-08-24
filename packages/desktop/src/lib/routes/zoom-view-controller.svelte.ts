/**
 * ZoomViewController — the single owner of the preview zoom / view-mode /
 * fit-width / split-pane-drag state that used to live inline in `+page.svelte`.
 *
 * Centralises the preview layout surface: the numeric-vs-fit-width zoom intents
 * (`applyZoom` / `stepZoom` / `applyFitWidthZoom`), pushing the single/
 * two-column page layout into the viewer (`applyViewMode`), and the
 * editor↔preview split-pane drag (`splitPaneRatio` / `draggingSplit` + the
 * begin/move/end drag intents and the per-project `restoreSplitRatio`).
 *
 * View mode is NOT state here. It is derived from the workspace mode (see
 * `WorkspaceMode` in platform/shared-types.ts), so `applyViewMode` only
 * relays that derived value to the viewer — there is nothing to persist, and
 * no "the user picked one" lock to hold.
 *
 * Single-owner discipline mirrors `PageNavController`
 * (`routes/page-nav-controller.svelte.ts`): the component reads the public rune
 * getters and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the live preview client, the `zoom` / `isNarrow`
 * accessors, the persist sinks (`persistZoom` / `persistSplitRatio` = the
 * durable settings-store writers, `saveDesktopPrefs` = the guarded per-project
 * writer), and the two DOM measurements (`measureContainerWidth` = the preview
 * iframe's width, `measureWorkspaceRect` = the split container's rect). ZERO
 * direct DOM / `node:*` / lib value imports.
 */

import {
  clampSplitRatio,
  splitRatioFromDrag,
  snapSplitRatio,
  nudgeSplitRatio,
  DEFAULT_SPLIT_RATIO,
  SPLIT_ARROW_STEP,
} from "$lib/editor/preview-layout";

/** Minimal host-command client surface the controller drives. */
interface ZoomViewClient {
  call<T>(cmd: string, args?: unknown[]): Promise<T>;
}

export interface ZoomViewDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => ZoomViewClient | undefined;
  /** Current durable zoom value ("fit-width" or a numeric string). */
  zoom: () => string;
  /** True below the responsive breakpoint (split drag is disabled). */
  isNarrow: () => boolean;
  /** Durable settings-store writer for the zoom value. */
  persistZoom: (value: string) => void;
  /** Durable settings-store writer for the split ratio (#103). */
  persistSplitRatio: (value: number) => void;
  /** Guarded per-project writer (split ratio). */
  saveDesktopPrefs: (patch: { splitPaneRatio?: number }) => void;
  /** Measured width of the preview container (iframe.clientWidth ?? innerWidth). */
  measureContainerWidth: () => number;
  /** Measured split-container rect, or null when the workspace isn't mounted. */
  measureWorkspaceRect: () => { left: number; width: number } | null;
}

export class ZoomViewController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Editor↔preview split ratio (fraction of width given to the editor). */
  splitPaneRatio = $state(0.42);
  /** True while the split-pane divider is being dragged. */
  draggingSplit = $state(false);

  private deps: ZoomViewDeps;

  constructor(deps: ZoomViewDeps) {
    this.deps = deps;
  }

  // ── Zoom ────────────────────────────────────────────────────────────────────

  /** Apply fit-width by querying the page's rendered width from the iframe. */
  async applyFitWidthZoom(): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    try {
      const dims = await client.call<{ width: number; height: number; viewportWidth?: number } | null>("getPageDimensions");
      const pageWidth = dims?.width ?? 0;
      // Measure after the async dimension query so overlapping resize calls
      // all use the newest pane width. CSS `zoom` scales the stage's 32px
      // padding too, so fit the complete page/run + both gutters. Subtracting
      // unscaled padding produced unequal left/right gaps and overflow.
      const measuredWidth = this.deps.measureContainerWidth();
      // The iframe element includes its own vertical scrollbar, while the
      // preview document lays out against documentElement.clientWidth. Use the
      // smaller width so a fit never overflows or shifts by one scrollbar.
      const previewWidth = dims?.viewportWidth ?? measuredWidth;
      const containerWidth = Math.min(measuredWidth, previewWidth);
      const scale = pageWidth > 0 && containerWidth > 0
        ? Math.max(0.25, Math.min(4, containerWidth / (pageWidth + 64)))
        : 1;
      await client.call("setZoom", [scale]);
    } catch {
      await client.call("setZoom", [1]).catch(() => {});
    }
  }

  applyZoom(value: string): void {
    this.deps.persistZoom(value);
    const client = this.deps.client();
    if (!client) return;
    if (value === "fit-width") {
      void this.applyFitWidthZoom();
    } else {
      client.call("setZoom", [Number(value)]).catch(() => {});
    }
  }

  stepZoom(delta: number): void {
    const zoom = this.deps.zoom();
    const current = zoom === "fit-width" ? 1 : parseFloat(zoom) || 1;
    const next = Math.max(0.25, Math.min(4, current + delta));
    this.applyZoom(String(Math.round(next * 100) / 100));
  }

  // ── View mode ─────────────────────────────────────────────────────────────

  /** Relay the derived view mode into the viewer, then re-fit if fitting. */
  applyViewMode(mode: "single" | "two-column"): void {
    const client = this.deps.client();
    if (!client) return;
    void client.call("setViewMode", [mode])
      .then(() => {
        if (this.deps.zoom() === "fit-width") return this.applyFitWidthZoom();
      })
      .catch(() => {});
  }

  // ── Split-pane drag ─────────────────────────────────────────────────────────

  /**
   * Begin a split drag from the given pointer X. Returns true when the drag
   * actually started (the component then captures the pointer); false when the
   * layout can't be dragged (narrow viewport or no mounted workspace).
   */
  beginSplitDrag(pointerX: number): boolean {
    if (this.deps.isNarrow()) return false;
    if (!this.deps.measureWorkspaceRect()) return false;
    this.draggingSplit = true;
    this.updateSplitFromPointer(pointerX, false);
    return true;
  }

  moveSplitDrag(pointerX: number): void {
    if (!this.draggingSplit) return;
    this.updateSplitFromPointer(pointerX, false);
  }

  /**
   * End an in-progress split drag, persisting the final ratio. Returns true when
   * a drag was active (the component then releases the pointer capture).
   */
  endSplitDrag(pointerX: number): boolean {
    if (!this.draggingSplit) return false;
    this.draggingSplit = false;
    this.updateSplitFromPointer(pointerX, true);
    return true;
  }

  /** Restore a saved split ratio (clamped), without persisting. */
  restoreSplitRatio(value: number): void {
    this.splitPaneRatio = clampSplitRatio(value);
  }

  /**
   * Double-click reset (#103): return to the breakpoint default and persist.
   */
  resetSplitRatio(): void {
    this.splitPaneRatio = DEFAULT_SPLIT_RATIO;
    this.persistSplit();
  }

  /**
   * Keyboard nudge (#103, WCAG 2.2 SC 2.5.7): move the split by `direction`
   * steps of ~2% (direction is typically -1 / +1) and persist.
   */
  nudgeSplit(direction: number): void {
    this.splitPaneRatio = nudgeSplitRatio(this.splitPaneRatio, direction * SPLIT_ARROW_STEP);
    this.persistSplit();
  }

  /**
   * Persist the current ratio to BOTH the durable settings store (survives
   * restart) and the per-project bucket (restores the project's own layout on
   * reopen). Re-fits a fit-width preview so the page keeps filling the
   * resized pane.
   */
  private persistSplit(): void {
    this.deps.persistSplitRatio(this.splitPaneRatio);
    this.deps.saveDesktopPrefs({ splitPaneRatio: this.splitPaneRatio });
    if (this.deps.zoom() === "fit-width") void this.applyFitWidthZoom();
  }

  private updateSplitFromPointer(pointerX: number, persist: boolean): void {
    const rect = this.deps.measureWorkspaceRect();
    if (!rect) return;
    const raw = splitRatioFromDrag({
      containerLeft: rect.left,
      containerWidth: rect.width,
      pointerX,
    });
    // Snap only on release; free drag stays unsnapped for live feedback.
    if (persist) {
      this.splitPaneRatio = snapSplitRatio(raw);
      this.persistSplit();
    } else {
      this.splitPaneRatio = raw;
      if (this.deps.zoom() === "fit-width") void this.applyFitWidthZoom();
    }
  }
}
