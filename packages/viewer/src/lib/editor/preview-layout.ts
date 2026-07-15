export interface SplitDragInput {
  containerLeft: number;
  containerWidth: number;
  pointerX: number;
}

/** Breakpoint default split (editor fraction) — restored by double-click reset. */
export const DEFAULT_SPLIT_RATIO = 0.42;
const MIN_SPLIT_RATIO = 0.25;
const MAX_SPLIT_RATIO = 0.75;
const SPLITTER_WIDTH_PX = 6;
const REFIT_WIDTH_THRESHOLD_PX = 2;

/** Ratios the drag snaps to on release (editor fractions), #103. */
const SPLIT_SNAP_POINTS = [0.25, 0.5, 0.6, 0.75] as const;
/** How close (in ratio) a released drag must be to a snap point to snap. */
const SPLIT_SNAP_THRESHOLD = 0.03;
/** Ratio delta applied per Arrow-key press on the focused splitter (~2%). */
export const SPLIT_ARROW_STEP = 0.02;

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, value));
}

export function splitRatioFromDrag(input: SplitDragInput): number {
  if (!Number.isFinite(input.containerWidth) || input.containerWidth <= 0) {
    return DEFAULT_SPLIT_RATIO;
  }
  const raw = (input.pointerX - input.containerLeft) / input.containerWidth;
  return Math.round(clampSplitRatio(raw) * 1000) / 1000;
}

/**
 * Snap a (freely-dragged) ratio to the nearest of `snaps` when it lands within
 * `threshold` of one, else return the ratio unchanged. Result is always clamped
 * to the MIN/MAX bounds so free drag between snaps stays honoured (#103, WCAG
 * 2.2 SC 2.5.7 — the snap is a convenience on release, not a hard constraint).
 */
export function snapSplitRatio(
  ratio: number,
  snaps: readonly number[] = SPLIT_SNAP_POINTS,
  threshold: number = SPLIT_SNAP_THRESHOLD,
): number {
  const clamped = clampSplitRatio(ratio);
  let nearest = clamped;
  let nearestDist = Infinity;
  for (const snap of snaps) {
    const dist = Math.abs(clamped - snap);
    if (dist < nearestDist) {
      nearest = snap;
      nearestDist = dist;
    }
  }
  const result = nearestDist <= threshold ? clampSplitRatio(nearest) : clamped;
  return Math.round(result * 1000) / 1000;
}

/**
 * Adjust a ratio by `delta` (e.g. ±SPLIT_ARROW_STEP for keyboard nudges),
 * clamped and rounded to 3 decimals to match `splitRatioFromDrag`. The
 * keyboard, non-drag alternative to dragging the splitter (WCAG 2.2 SC 2.5.7).
 */
export function nudgeSplitRatio(ratio: number, delta: number): number {
  const base = Number.isFinite(ratio) ? ratio : DEFAULT_SPLIT_RATIO;
  return Math.round(clampSplitRatio(base + delta) * 1000) / 1000;
}

export function splitTemplateColumns(ratio: number): string {
  const clamped = clampSplitRatio(ratio);
  const editorPct = Math.round(clamped * 100);
  const previewPct = 100 - editorPct;
  return `minmax(240px, ${editorPct}%) ${SPLITTER_WIDTH_PX}px minmax(360px, ${previewPct}%)`;
}

export function shouldRefitPreview(zoom: string, previousWidth: number, nextWidth: number): boolean {
  if (zoom !== "fit-width") return false;
  if (!Number.isFinite(previousWidth) || !Number.isFinite(nextWidth)) return false;
  return Math.abs(nextWidth - previousWidth) > REFIT_WIDTH_THRESHOLD_PX;
}
