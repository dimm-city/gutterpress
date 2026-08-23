/**
 * Regression guard: the viewer's columns must be as wide as the printed page's
 * content box, not as wide as the pseudo-less `@page` rule claims.
 *
 * `@page :left` / `@page :right` swapping the binding and outer margin is what
 * every bound book does, and Chromium honours it when it prints. The viewer
 * sized its columns from `resolvePage(model, { name })` — no pseudos — so for
 * the field guide's 0.625in outer / 0.75in binding it laid out a column an
 * eighth of an inch wider than the PDF's on EVERY page. Wider lines hold more
 * text, paragraphs run shorter, and the page count drifts below print's a
 * little more with every page: 280 preview pages against 288 printed ones, the
 * drift accumulating in ones and twos rather than at any one site, which is
 * what made it look like a dozen unrelated bugs.
 *
 * `docs/fixtures/mirrored-margins` is the same failure end-to-end in five
 * pages, and is measured by the parity gate. These cases pin the decision
 * itself so it cannot regress without a fast test saying so.
 */
import { test, expect } from "bun:test";
import { extract } from "../shared/gcpm-extract.ts";
import { runPageBox } from "./fragment.ts";

const IN = 72;

const MIRRORED = `
@page { size: 6in 9in; margin: 0.75in 0.5in; }
@page :left  { margin-left: 0.5in; margin-right: 1in; }
@page :right { margin-left: 1in; margin-right: 0.5in; }
`;

test("mirrored binding margins size the column from the printed content box", () => {
  const g = runPageBox(extract(MIRRORED), undefined);
  // Print wraps at 6in - 0.5in - 1in = 4.5in on both sides. The pseudo-less
  // rule would have said 5in.
  expect(g.width - g.margin.left - g.margin.right).toBeCloseTo(4.5 * IN, 5);
  // Page 1 is a recto, so the recto's own margins are the ones taken.
  expect(g.margin.left).toBeCloseTo(1 * IN, 5);
  expect(g.margin.right).toBeCloseTo(0.5 * IN, 5);
});

test("the strip stays geometrically coherent: margins + content = the sheet", () => {
  // `.gp-strip`'s column-gap is `margin-right + margin-left + sheet-gap`, so
  // the page pitch is only right while the three numbers still sum to the
  // sheet. A content box taken from one rule and margins from another would
  // silently shear every page position after the first.
  const g = runPageBox(extract(MIRRORED), undefined);
  expect(g.margin.left + (g.width - g.margin.left - g.margin.right) + g.margin.right).toBeCloseTo(
    g.width,
    5,
  );
});

test("a named page mirrors on its own rules, not the default page's", () => {
  const g = runPageBox(
    extract(`
      ${MIRRORED}
      @page plate { margin: 0; }
    `),
    "plate",
  );
  expect(g.margin.left).toBe(0);
  expect(g.width - g.margin.left - g.margin.right).toBeCloseTo(6 * IN, 5);
});

test("a book with no pseudo-page rules is unchanged", () => {
  const warnings: string[] = [];
  const g = runPageBox(extract(`@page { size: 6in 9in; margin: 0.75in; }`), undefined, warnings);
  expect(g.width - g.margin.left - g.margin.right).toBeCloseTo(4.5 * IN, 5);
  expect(warnings).toEqual([]);
});

test("sides that disagree on the content SIZE keep the old box and say so", () => {
  // Print alternates two different column widths here; one multicol cannot.
  // Guessing a side would be a silent, unmeasurable divergence, so the
  // pseudo-less box stays and the author is told.
  const warnings: string[] = [];
  const g = runPageBox(
    extract(`
      @page { size: 6in 9in; margin: 0.75in 0.5in; }
      @page :left  { margin-left: 0.5in; margin-right: 1.5in; }
      @page :right { margin-left: 1in;   margin-right: 0.5in; }
    `),
    undefined,
    warnings,
  );
  expect(g.width - g.margin.left - g.margin.right).toBeCloseTo(5 * IN, 5);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("@page :left and @page :right");
});
