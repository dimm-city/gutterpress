/**
 * CSS-only pagination for the editing surface.
 *
 * The editor shows real, page-sized boxes without running the paginator. That
 * distinction is the single most important constraint in this design: the
 * previous attempt mounted `engine/viewer/fragment.ts` — which reparents
 * nodes, injects measured spacer divs and synthesizes table-header shim rows —
 * over ProseMirror's own DOM. ProseMirror's `DOMObserver` saw external
 * mutation and reverted it, and the fix (detaching the observer around every
 * layout pass) became a standing obligation on every future caller. **The
 * editor must never import `fragment.ts`.**
 *
 * What replaces it is a stylesheet. Chromium fragments a multicol box
 * natively; with `column-wrap: wrap` and `column-count: 1` the columns stack
 * vertically, so each column IS a page and they read top-to-bottom. Nothing
 * mutates the document, so the caret, undo and selection are the browser's
 * own.
 *
 * Everything here is derived from the author's own CSS — `@page` geometry,
 * their `break-*` declarations, their `page: NAME` assignments — read through
 * `gutterpress/render`, the same reader the PDF path uses. The editor invents
 * no selectors of its own, so a book cannot come to depend on editor
 * internals.
 *
 * ## How close this gets to print, measured
 *
 * Page count, editor vs the shipped PDF, across every parity-gate fixture
 * (Chromium 153, real books, real stylesheets):
 *
 * | book                  | print | editor |       |
 * |-----------------------|-------|--------|-------|
 * | gp-image-positioning  |     7 |      7 | exact |
 * | book-01 / book-02     |     2 |      1 |    -1 |
 * | design guide          |    54 |     51 |    -3 |
 * | user guide            |    64 |     60 |    -4 |
 * | css-authoring-spike   |     7 |     10 |    +3 |
 *
 * **This is not parity and is not meant to be.** Parity is required between
 * the print preview and the PDF — `scripts/native-parity-gate.ts` enforces
 * that, on the real fragmenter. The editor's job is to show the author their
 * text at the size, measure and typography it will print at, with page breaks
 * in approximately the right places. The numbers above are recorded so that
 * gap is a known quantity rather than a surprise.
 *
 * The three known causes, in order of size:
 *
 * 1. **Sheet-sized elements** (`@page cover { margin: 0 }`, `.gp-bleed`). A
 *    column is the CONTENT box, so an element sized to the full sheet cannot
 *    fit in one and spills into the next. This is what over-counts the
 *    css-authoring-spike fixture.
 * 2. **Named pages that resize the page box.** `namedPageDelta()` absorbs a
 *    top-margin-only difference as padding — that alone recovered 4 of the
 *    design guide's 7 missing pages — but a named page with a different sheet
 *    size or bottom margin has no multicol equivalent and is skipped.
 * 3. **Multicol and paged media avoid breaks differently.** The residual, and
 *    the same difference the parked user-guide preview/PDF divergence turns
 *    on.
 */
import { extract, mediaPrintBodies, resolvePage } from "gutterpress/render";
import type { GcpmModel, PageGeometry } from "gutterpress/render";

/** CSS px per PostScript point — `@page` geometry is in pt. */
const PX_PER_PT = 96 / 72;

/**
 * Break values that mean "start a new PAGE". These are the ones with no
 * meaning inside a multicol box, so these are the ones that need mapping;
 * `column` already works natively and is left alone.
 */
const FORCED_PAGE_LIKE = /^(page|left|right|recto|verso)$/;

export interface PaginateOptions {
  /** 1 = a vertical stack of pages, 2 = facing spreads. */
  columns?: 1 | 2;
  /** Gap between page boxes, in px. */
  gap?: number;
  /** Selector for the editable root. */
  root?: string;
}

const px = (pt: number) => `${Math.round(pt * PX_PER_PT * 1000) / 1000}px`;

/**
 * Whether this browser can stack multicol columns into rows.
 *
 * CSS Multicol L2 (`column-wrap` / `column-height`) shipped unflagged in
 * Chrome/Edge 145+. Electron 42 bundles Chromium 148, so the packaged app
 * always has it — but this is feature-probed rather than assumed, matching
 * `fragment.ts`'s own `spreadModeSupported()`. Without it the editor still
 * works; the pages simply run in one long horizontal row.
 */
export function stackedPagesSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("column-wrap", "wrap") &&
    CSS.supports("column-height", "100px")
  );
}

/**
 * The whole editor stylesheet, from the book's own CSS text.
 *
 * One call, because the four layers are not independently useful and getting
 * one of them wrong is silent: a caller that forgets `mediaPrintBodies` lays
 * out different CSS than the PDF does and has no way to notice.
 */
export function editorStylesheet(css: string, opts: PaginateOptions = {}): string {
  const model = extract(css);
  return [
    // A book stylesheet is a PRINT stylesheet; on screen its `@media print`
    // bodies never apply. The viewer re-injects them as screen rules
    // (`fragment.ts`), and the editor must do the same or it is laying out
    // CSS the PDF never saw.
    mediaPrintBodies(css).join("\n"),
    paginationCss(resolvePage(model).geometry, opts),
    breakMappingCss(model, opts.root),
    namedPageCss(model, opts.root),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The stylesheet that turns an editable root into page-sized boxes.
 *
 * Deliberately emits NO rules that touch the author's own content — only the
 * root box. Anything else would make the editor's CSS part of the book's
 * cascade, which is exactly the coupling that made the Paged.js migration
 * expensive.
 */
export function paginationCss(geometry: PageGeometry, opts: PaginateOptions = {}): string {
  const { columns = 1, gap = 24, root = ".gp-editor-page-flow" } = opts;

  const contentW = geometry.width - geometry.margin.left - geometry.margin.right;
  const contentH = geometry.height - geometry.margin.top - geometry.margin.bottom;

  // Column gap carries the two horizontal margins plus the visual gutter, so
  // consecutive page boxes sit exactly one page-pitch apart — the same
  // arithmetic `viewer.css` uses for its strips.
  const colGap = geometry.margin.left + geometry.margin.right + gap / PX_PER_PT;
  const rowGap = geometry.margin.top + geometry.margin.bottom + gap / PX_PER_PT;

  return `${root} {
  box-sizing: content-box;
  width: ${px(contentW)};
  height: ${px(contentH)};
  column-width: ${px(contentW)};
  column-height: ${px(contentH)};
  column-count: ${columns};
  column-gap: ${px(colGap)};
  row-gap: ${px(rowGap)};
  column-fill: auto;
  column-wrap: wrap;
  margin: ${px(geometry.margin.top)} ${px(geometry.margin.right)} ${px(geometry.margin.bottom)} ${px(geometry.margin.left)};
  /* Overflow must stay visible: with a fixed height and no column-count cap,
     Chromium creates as many columns as the content needs and they extend
     past this box. Clipping here would hide every page after the first. */
  overflow: visible;
}`;
}

/**
 * Map the author's forced PAGE breaks onto column breaks.
 *
 * A `break-before: page` is inert inside a multicol box — only column breaks
 * fragment there — so without this the editor ignores every deliberate page
 * break in the book. Measured across the fixtures: the mapping is worth up to
 * 4 pages (user guide 56 -> 60).
 *
 * The selectors are the AUTHOR'S, read from the extracted model, not a list
 * maintained here. That matters twice over: an earlier version of this file
 * guessed at `.page, .spread, .gp-page-break` and would have silently missed
 * `h1 { break-before: page }`, which is how both the design guide and the user
 * guide actually start their chapters; and because `MARKER_CSS` is part of the
 * collected CSS, the marker-emitted rules arrive through the same channel
 * rather than being duplicated here.
 *
 * `:where()` keeps specificity at zero so this cannot outrank an author rule
 * that deliberately sets `break-before: auto` on the same element.
 *
 * What it does NOT do is de-duplicate a break that flow already satisfied —
 * `fragment.ts` needs measured DOM spacers for that, and inserting those is
 * the mutation this design exists to avoid. The cost is an occasional
 * redundant page.
 */
export function breakMappingCss(model: GcpmModel, root = ".gp-editor-page-flow"): string {
  const rules = model.breaks
    .filter((b) => b.prop !== "break-inside" && FORCED_PAGE_LIKE.test(b.value.trim()))
    .map((b) => `${root} :where(${b.selector}) { ${b.prop}: column; }`);
  return [...new Set(rules)].join("\n");
}

/**
 * Reproduce each `page: NAME` assignment's content box, where it can be.
 *
 * See `namedPageDelta()` for why this is padding and when it refuses.
 */
export function namedPageCss(model: GcpmModel, root = ".gp-editor-page-flow"): string {
  const base = resolvePage(model).geometry;
  const rules: string[] = [];
  for (const assignment of model.pageAssignments) {
    const named = resolvePage(model, { name: assignment.page }).geometry;
    const delta = namedPageDelta(base, named);
    if (!delta || delta.paddingTop === "0px") continue;
    rules.push(`${root} :where(${assignment.selector}) { padding-top: ${delta.paddingTop}; }`);
  }
  return [...new Set(rules)].join("\n");
}

/**
 * The margin delta a named page needs, expressed as padding on the element
 * that triggers it.
 *
 * `@page NAME { margin-top: 2.5in }` has no multicol equivalent — a column has
 * one size. But when the named page differs only in its TOP margin, the
 * difference can be absorbed as padding on the element that starts it: the
 * column keeps its height, content starts lower, and the page still ends at
 * the same bottom edge. This is not a micro-optimization — the design guide's
 * `@page chapter` is exactly this shape, and applying it recovered 4 of that
 * book's 7 missing pages.
 *
 * Returns `null` when the sheet size or bottom margin differs too, because
 * then the page is genuinely a different box and padding cannot express it.
 * `@page cover { margin: 0 }` is the common case, and refusing is the honest
 * answer: the element keeps base geometry and its page may fragment
 * differently than it prints.
 */
export function namedPageDelta(
  base: PageGeometry,
  named: PageGeometry,
): { paddingTop: string } | null {
  const sameBottom = Math.abs(base.margin.bottom - named.margin.bottom) < 0.01;
  const sameSize =
    Math.abs(base.width - named.width) < 0.01 && Math.abs(base.height - named.height) < 0.01;
  if (!sameBottom || !sameSize) return null;
  const delta = named.margin.top - base.margin.top;
  if (Math.abs(delta) < 0.01) return { paddingTop: "0px" };
  return { paddingTop: px(delta) };
}
