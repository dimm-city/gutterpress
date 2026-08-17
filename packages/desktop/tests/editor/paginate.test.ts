import { expect, test } from "bun:test";
import { extract, resolvePage } from "gutterpress/render";
import {
  breakMappingCss,
  editorStylesheet,
  namedPageCss,
  namedPageDelta,
  paginationCss,
} from "../../src/lib/editor/paginate";

/**
 * The editor's pagination is a STYLESHEET, not a layout pass. These tests
 * assert what that stylesheet says; the page counts it actually produces in a
 * browser are recorded in `paginate.ts`'s header, measured against the parity
 * gate's fixtures.
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

test("spread mode asks for two columns per row", () => {
  expect(paginationCss(resolvePage(extract(BOOK_CSS)).geometry, { columns: 2 })).toContain(
    "column-count: 2;",
  );
});
