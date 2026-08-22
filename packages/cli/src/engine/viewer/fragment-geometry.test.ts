/**
 * Cross-browser regression guard for `synthesizeColumnBreaks`'s geometry
 * reading (issue #46 preview smoke test).
 *
 * The reserve-spacer technique measures a break site's fragment rects
 * against its column. Blink and Gecko fragment the SAME document to the same
 * pages but describe the boundary differently at sub-pixel scale, and
 * 0.10.0-alpha.4 read Gecko's description as "there is still room in this
 * column": the feature-probe fixture paginated to 6 pages in Firefox against
 * a 4-page Chromium/print baseline — a 50% preview↔print divergence.
 *
 * Every number below is a VERBATIM measurement from that failing run
 * (`tests/compat/fixtures/feature-probe`, US-Letter strip, 888px columns at
 * strip top y=84), so these cases pin the exact shapes that broke, not a
 * reconstruction of them.
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

test("a hairline leading fragment is not the site's content edge", () => {
  // Gecko, feature-probe `.page` #2 after the preceding spacer landed: a
  // 0.3px sliver stranded at the bottom of column 2 (y=971.7, column bottom
  // 972) plus the real fragment at the top of column 3 (y=84). Blink emits
  // only the second rect. Reading rects[0] put the site 887.7px down its
  // column — the bottom — so the fragmenter reserved a spacer for a site
  // that had ALREADY moved to the next column.
  const gecko = fakeSite([
    { top: 971.7, height: 0.3 },
    { top: 84, height: 886.7 },
  ]);
  const blink = fakeSite([{ top: 84, height: 887 }]);

  expect(contentEdgeRect(gecko, false)!.top).toBe(84);
  expect(contentEdgeRect(blink, false)!.top).toBe(84);
  // Both engines must therefore reach the same verdict: nothing to reserve.
  for (const site of [gecko, blink]) {
    expect(columnReserve(contentEdgeRect(site, false)!.top - STRIP_TOP, COLUMN_H)).toBeNull();
  }
});

test("a hairline trailing fragment is not the site's content edge", () => {
  // The break-after mirror image: a site whose content ends at y=971 but
  // which trails a hairline into the next column. Reading rects.at(-1) would
  // put its end 0.3px down the NEXT column and reserve a whole blank one.
  const site = fakeSite([
    { top: 300, height: 671 },
    { top: 84, height: 0.3 },
  ]);
  expect(contentEdgeRect(site, true)!.bottom).toBe(971);
  expect(columnReserve(971 - STRIP_TOP, COLUMN_H)).toBe(1);
});

test("all-hairline rects fall back to the real (thin) content edge", () => {
  const site = fakeSite([{ top: 500, height: 0.4 }]);
  expect(contentEdgeRect(site, false)!.top).toBe(500);
  expect(contentEdgeRect(site, true)!.bottom).toBeCloseTo(500.4, 5);
});

test("no rects at all yields no content edge", () => {
  expect(contentEdgeRect(fakeSite([]), false)).toBeUndefined();
  expect(contentEdgeRect(fakeSite([]), true)).toBeUndefined();
});

test("a site a sub-pixel below its column top counts as already broken", () => {
  // The second half of the Firefox divergence, and a latent bug in every
  // engine: `columnReserve` rounds the spacer UP so it is guaranteed to
  // overflow the column, and that overshoot (< 1px) re-appears at the top of
  // the next column. Gecko then reported the moved `.page` at y=84.7 — 0.7px
  // below its column top. Under the old 0.5px tolerance the wrapper/inner-
  // heading pair failed to dedupe and the second site reserved 888px: one
  // wholly blank page, twice over, which is precisely the 4pp → 6pp gap.
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
  // The one spacer the fixture legitimately needs, in each engine: font
  // metrics differ, so the same break site sits at a different offset — but
  // both reserve to the same column bottom and both produce page 2.
  expect(columnReserve(261.69, COLUMN_H)).toBe(627); // blink
  expect(columnReserve(301.7, COLUMN_H)).toBe(587); // gecko
});
