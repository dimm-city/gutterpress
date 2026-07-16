import { test, expect } from "bun:test";
import {
  splitRatioFromDrag,
  splitTemplateColumns,
  shouldRefitPreview,
  snapSplitRatio,
  nudgeSplitRatio,
  DEFAULT_SPLIT_RATIO,
  SPLIT_ARROW_STEP,
} from "../../src/lib/editor/preview-layout";

test("splitRatioFromDrag turns a pointer x into a clamped editor ratio", () => {
  expect(splitRatioFromDrag({ containerLeft: 100, containerWidth: 1000, pointerX: 500 })).toBe(0.4);
  expect(splitRatioFromDrag({ containerLeft: 100, containerWidth: 1000, pointerX: -100 })).toBe(0.25);
  expect(splitRatioFromDrag({ containerLeft: 100, containerWidth: 1000, pointerX: 2000 })).toBe(0.75);
});

test("splitTemplateColumns emits editor, splitter, preview grid tracks", () => {
  expect(splitTemplateColumns(0.4)).toBe("minmax(240px, 40%) 6px minmax(360px, 60%)");
});

test("splitTemplateColumns falls back to the default ratio for invalid values", () => {
  expect(splitTemplateColumns(Number.NaN)).toBe("minmax(240px, 42%) 6px minmax(360px, 58%)");
});

test("shouldRefitPreview only refits fit-width previews after a real width change", () => {
  expect(shouldRefitPreview("fit-width", 600, 640)).toBe(true);
  expect(shouldRefitPreview("1", 600, 640)).toBe(false);
  expect(shouldRefitPreview("fit-width", 600, 601)).toBe(false);
});

test("snapSplitRatio snaps to the nearest snap point within the threshold", () => {
  // Within ~3% of a snap point → snaps.
  expect(snapSplitRatio(0.49)).toBe(0.5);
  expect(snapSplitRatio(0.62)).toBe(0.6);
  expect(snapSplitRatio(0.27)).toBe(0.25);
  expect(snapSplitRatio(0.74)).toBe(0.75);
});

test("snapSplitRatio leaves free-drag ratios between snaps unchanged", () => {
  // Too far from any snap point → stays put (free drag honoured).
  expect(snapSplitRatio(0.4)).toBe(0.4);
  expect(snapSplitRatio(0.55)).toBe(0.55);
});

test("snapSplitRatio clamps to the MIN/MAX bounds", () => {
  expect(snapSplitRatio(0.1)).toBe(0.25);
  expect(snapSplitRatio(0.9)).toBe(0.75);
});

test("nudgeSplitRatio steps by the delta, clamped and rounded to 3 decimals", () => {
  expect(nudgeSplitRatio(0.5, SPLIT_ARROW_STEP)).toBe(0.52);
  expect(nudgeSplitRatio(0.5, -SPLIT_ARROW_STEP)).toBe(0.48);
  // Clamps at the bounds rather than overshooting.
  expect(nudgeSplitRatio(0.74, SPLIT_ARROW_STEP)).toBe(0.75);
  expect(nudgeSplitRatio(0.26, -SPLIT_ARROW_STEP)).toBe(0.25);
  // Non-finite input falls back to the default before nudging.
  expect(nudgeSplitRatio(Number.NaN, SPLIT_ARROW_STEP)).toBe(
    Math.round((DEFAULT_SPLIT_RATIO + SPLIT_ARROW_STEP) * 1000) / 1000,
  );
});
