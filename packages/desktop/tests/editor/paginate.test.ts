import { expect, test } from "bun:test";
import { extract, resolvePage } from "gutterpress/render";
import {
  breakMappingCss,
  editorStylesheet,
  namedPageCss,
  namedPageDelta,
  paginatedWidth,
  paginationCss,
  scrollContainerCss,
} from "../../src/lib/editor/paginate";

/**
 * The editor's pagination is a STYLESHEET, not a layout pass. These tests
 * assert what that stylesheet says. What it does to page counts in a real
 * browser is not asserted anywhere and is not claimed anywhere either — see
 * `paginate.ts`'s header for why a table of per-book deltas that no gate
 * re-derives was removed rather than refreshed.
 *
 * The property that matters most here is the one an earlier draft got wrong:
 * every selector must come from the AUTHOR'S css, never from a list kept in
 * our source. That draft hardcoded `.page, .spread, .gp-page-break` and would
 * have silently ignored `h1 { break-before: page }` — which is how both
 * first-party books actually start their chapters.
 */

/** The shape both first-party books use: a chapter opener on a named page. */
const BOOK_CSS = `
@page { size: 8.5in 11in; margin: 0.875in 0.875in 1in; }
@page chapter { margin-top: 2.5in; }
@page cover { margin: 0; }
h1 { break-before: page; page: chapter; }
.cover-page { page: cover; }
.page { break-before: page; }
.gp-column-break { break-after: column; }
@media print { .only-in-print { color: red; } }
`;

test("page geometry becomes a stack of page-sized columns", () => {
  const css = paginationCss(resolvePage(extract(BOOK_CSS)).geometry);
  // 8.5in - 0.875 - 0.875 = 6.75in = 648px; 11in - 0.875 - 1 = 9.125in = 876px
  expect(css).toContain("column-width: 648px;");
  expect(css).toContain("column-height: 876px;");
  // Each column is one page, and they stack downward rather than run right.
  expect(css).toContain("column-count: 1;");
  expect(css).toContain("column-wrap: wrap;");
  expect(css).toContain("column-fill: auto;");
  // Clipping here would hide every page after the first.
  expect(css).toContain("overflow: visible;");
});

test("forced PAGE breaks are mapped to column breaks, using the author's selectors", () => {
  const css = breakMappingCss(extract(BOOK_CSS));
  // The one an earlier hardcoded list would have missed.
  expect(css).toContain(":where(h1) { break-before: column; }");
  expect(css).toContain(":where(.page) { break-before: column; }");
});

test("a break already authored as `column` is left alone", () => {
  // It already fragments a multicol box natively; re-emitting it would be
  // noise, and `break-inside` has nothing to map onto.
  const css = breakMappingCss(extract(BOOK_CSS));
  expect(css).not.toContain(".gp-column-break");
});

test("the mapping cannot outrank an author's own break declaration", () => {
  // `:where()` contributes zero specificity, so `h1 { break-before: auto }`
  // in the book's own stylesheet still wins.
  for (const rule of breakMappingCss(extract(BOOK_CSS)).split("\n")) {
    expect(rule).toContain(":where(");
  }
});

test("a named page that only moves the top margin becomes padding", () => {
  const model = extract(BOOK_CSS);
  const base = resolvePage(model).geometry;
  const chapter = resolvePage(model, { name: "chapter" }).geometry;
  // 2.5in - 0.875in = 1.625in = 156px
  expect(namedPageDelta(base, chapter)).toEqual({ paddingTop: "156px" });
  expect(namedPageCss(model)).toContain(":where(h1) { padding-top: 156px; }");
});

test("a named page that resizes the page box is REFUSED, not approximated", () => {
  const model = extract(BOOK_CSS);
  const base = resolvePage(model).geometry;
  // `@page cover { margin: 0 }` is a different content box, not a shifted one.
  expect(namedPageDelta(base, resolvePage(model, { name: "cover" }).geometry)).toBeNull();
  expect(namedPageCss(model)).not.toContain(".cover-page");
});

test("editorStylesheet re-injects @media print bodies as screen rules", () => {
  // A book stylesheet is a print stylesheet. Miss this and the editor lays
  // out CSS the PDF never saw — silently.
  const css = editorStylesheet(BOOK_CSS);
  expect(css).toContain(".only-in-print");
});

test("editorStylesheet composes every layer in one call", () => {
  const css = editorStylesheet(BOOK_CSS);
  expect(css).toContain("column-wrap: wrap;"); // geometry
  expect(css).toContain(":where(h1) { break-before: column; }"); // breaks
  expect(css).toContain(":where(h1) { padding-top: 156px; }"); // named pages
});

test("the root selector is configurable and applied everywhere", () => {
  const css = editorStylesheet(BOOK_CSS, { root: "#doc" });
  expect(css).toContain("#doc {");
  expect(css).toContain("#doc :where(h1) { break-before: column; }");
  expect(css).toContain("#doc :where(h1) { padding-top: 156px; }");
  expect(css).not.toContain(".gp-editor-page-flow");
});

test("a book with no @page rules still produces a usable page box", () => {
  // Falling over on an unstyled project would make the editor unopenable for
  // a brand-new book, which is the first thing a new author has.
  const css = editorStylesheet("p { margin: 0 }");
  expect(css).toContain("column-wrap: wrap;");
  expect(css).toMatch(/column-height: \d+(\.\d+)?px;/);
});

test("spread mode widens the flow box, not just the column count", () => {
  // This test used to assert `column-count: 2` and nothing else, and it was
  // green against a stylesheet that rendered ONE column: the flow box was left
  // one page wide, and Multicol L1 §3.4 caps the used count at
  // `floor((width + column-gap) / (column-width + column-gap))` — exactly 1
  // when the available width is one column wide. Measured on Chromium 153, the
  // "spread" laid out byte-identically to the single stack. The width is what
  // makes the count real, so the width is what this asserts.
  const css = paginationCss(resolvePage(extract(BOOK_CSS)).geometry, { columns: 2 });
  expect(css).toContain("column-count: 2;");
  // 648px content + 192px column-gap (0.875in + 0.875in margins + 24px gutter)
  // + 648px content — one page pitch (840px) plus one more page.
  expect(css).toContain("width: 1488px;");
  expect(css).toContain("column-gap: 192px;");
});

test("the single-page stack keeps a one-page-wide flow box", () => {
  // The spread formula must collapse back to `contentW` at one column, or the
  // default path gains a second empty page slot to its right.
  const css = paginationCss(resolvePage(extract(BOOK_CSS)).geometry);
  expect(css).toContain("width: 648px;");
  expect(css).toContain("column-count: 1;");
});

test("paginatedWidth reports what a pane must be to show N pages", () => {
  // Whole SHEETS plus the gutters between them — the page margins are outside
  // the flow's `width`, so this is deliberately larger than that declaration.
  // The editor renders at 1 CSS px per print px, so this is the number the host
  // compares its pane against before asking for a spread.
  expect(paginatedWidth(BOOK_CSS)).toBe(816); // 8.5in
  expect(paginatedWidth(BOOK_CSS, { columns: 2 })).toBe(816 * 2 + 24);
  // No `@page` rule at all still answers, from the letter-size fallback —
  // a brand-new unstyled book must not make the fit test throw.
  expect(paginatedWidth("", { columns: 2 })).toBe(816 * 2 + 24);
});

/**
 * The scroll-container layer is the one place here that deliberately outranks
 * the author, so these assert the specificity split as much as the values —
 * getting it backwards would either fail to fix the pagination or clobber an
 * authored `display`.
 */
test("scroll containers: clips both axes and restores the formatting context", () => {
  const css = scrollContainerCss(extract(`pre { overflow: hidden }`), ".root");
  expect(css).toContain(".root pre { overflow-x: clip; overflow-y: clip; }");
  expect(css).toContain(":where(.root) :where(pre) { display: flow-root; }");
});

test("scroll containers: the overflow rule outranks the author's", () => {
  const css = scrollContainerCss(extract(`pre { overflow: hidden }`), ".root");
  // Author writes `pre { overflow: hidden }` (0-0-1). Ours is `.root pre`
  // (0-1-1) and comes later, so it wins. A `:where()` here would silently do
  // nothing at all.
  const overflowRule = css.split("\n").find((l) => l.includes("overflow-x"))!;
  expect(overflowRule.startsWith(".root pre")).toBe(true);
  expect(overflowRule).not.toContain(":where(.root pre)");
});

test("scroll containers: the display rule loses to any authored display", () => {
  const css = scrollContainerCss(extract(`.grid { display: grid; overflow: hidden }`), ".root");
  // Zero specificity on BOTH halves, so `.grid { display: grid }` (0-1-0)
  // wins and the grid keeps its display; only the UA default is overridden.
  expect(css).toContain(":where(.root) :where(.grid) { display: flow-root; }");
  expect(css).not.toContain(".root .grid { display");
});

test("scroll containers: a longhand clips only its own axis", () => {
  const css = scrollContainerCss(extract(`.wide { overflow-x: auto }`), ".root");
  expect(css).toContain(".root .wide { overflow-x: clip; }");
  expect(css).not.toContain("overflow-y");
});

test("scroll containers: a two-value shorthand clips only the scrolling axis", () => {
  const css = scrollContainerCss(extract(`.a { overflow: visible auto }`), ".root");
  expect(css).toContain(".root .a { overflow-y: clip; }");
  expect(css).not.toContain("overflow-x");
});

test("scroll containers: emits nothing when the book creates none", () => {
  expect(scrollContainerCss(extract(`pre { overflow: visible } .a { overflow: clip }`))).toBe("");
});

test("scroll containers: reach the composed stylesheet", () => {
  const sheet = editorStylesheet(`@page { size: 400px 500px; margin: 20px } pre { overflow: hidden }`);
  expect(sheet).toContain("overflow-x: clip");
  expect(sheet).toContain("display: flow-root");
});
