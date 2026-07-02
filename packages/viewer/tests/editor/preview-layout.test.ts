import { test, expect } from "bun:test";
import {
  splitRatioFromDrag,
  splitTemplateColumns,
  shouldRefitPreview,
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
