export interface SplitDragInput {
  containerLeft: number;
  containerWidth: number;
  pointerX: number;
}

const DEFAULT_SPLIT_RATIO = 0.42;
const MIN_SPLIT_RATIO = 0.25;
const MAX_SPLIT_RATIO = 0.75;
const SPLITTER_WIDTH_PX = 6;
const REFIT_WIDTH_THRESHOLD_PX = 2;

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
