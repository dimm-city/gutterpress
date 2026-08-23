/**
 * Regression guard for `columnReserve`'s sub-pixel tolerance.
 *
 * `columnReserve` rounds its spacer UP so the break is guaranteed to overflow
 * the column, and that overshoot (< 1px by construction) re-appears at the
 * top of the next column. At the original 0.5px tolerance a site sitting
 * 0.7px down its column read as real content, so a break that was ALREADY
 * satisfied reserved a whole blank column. That is a defect in Chromium as
 * much as anywhere — it was simply first surfaced by an engine whose
 * fragmentation residue made the offset reachable.
 *
 * The hairline-fragment cases this file used to carry were removed with the
 * `contentEdgeRect` filter they pinned: Gecko strands a ~0.3px sliver when a
 * box moves columns, Blink does not, and Gutterpress is Chromium-only
 * (CLAUDE.md).
 *
 * Numbers below are verbatim measurements from the run that failed
 * (US-Letter strip, 888px columns at strip top y=84).
 */
import { test, expect } from "bun:test";
import { columnReserve, contentEdgeRect } from "./fragment.ts";

const COLUMN_H = 888;
const STRIP_TOP = 84;

/** Minimal stand-in for the only geometry the fragmenter reads. */
function fakeSite(rects: Array<{ top: number; height: number }>): Element {
  return {
    getClientRects: () =>
      rects.map((r) => ({ top: r.top, bottom: r.top + r.height, height: r.height }) as DOMRect),
  } as unknown as Element;
}

test("no rects at all yields no content edge", () => {
  expect(contentEdgeRect(fakeSite([]), false)).toBeUndefined();
  expect(contentEdgeRect(fakeSite([]), true)).toBeUndefined();
});

test("a site a sub-pixel below its column top counts as already broken", () => {
  // `columnReserve` rounds the spacer UP so it is guaranteed to overflow the
  // column, and that overshoot (< 1px) re-appears at the top of the next
  // column — a moved box starts a fraction of a pixel BELOW its column top
  // rather than exactly on it. Under the old 0.5px tolerance a 0.7px offset
  // read as real content, so a wrapper/inner-heading pair failed to dedupe
  // and the second site reserved a full 888px: one wholly blank page, twice
  // over. The arithmetic is engine-independent; only the offset that exposed
  // it came from elsewhere.
  expect(columnReserve(0.7, COLUMN_H)).toBeNull();
  expect(columnReserve(0, COLUMN_H)).toBeNull();
  // The overshoot is bounded by Math.ceil, so 1px is the whole exposure —
  // a site a full pixel down its column is real content and still reserves.
  expect(columnReserve(1, COLUMN_H)).toBe(887);
});

test("a site a sub-pixel above its column bottom counts as already broken", () => {
  expect(columnReserve(COLUMN_H - 0.3, COLUMN_H)).toBeNull();
  expect(columnReserve(COLUMN_H, COLUMN_H)).toBeNull();
  expect(columnReserve(COLUMN_H + 5, COLUMN_H)).toBeNull();
});

test("a site mid-column reserves the rest of that column, rounded up", () => {
  // The one spacer the fixture legitimately needs.
  expect(columnReserve(261.69, COLUMN_H)).toBe(627);
});
