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
 * ## How close this gets to print
 *
 * Close, and deliberately not equal. **Parity is required between the print
 * PREVIEW and the PDF** — `scripts/native-parity-gate.ts` holds those two to
 * the same page for every instrumented element, on six books, at zero
 * divergences with an empty allowlist. The editor's job is a different one:
 * show the author their text at the size, measure and typography it will
 * print at, with page breaks in approximately the right places, fast enough
 * to keep up with typing.
 *
 * A table of per-book page-count deltas used to sit here and has been
 * removed rather than refreshed. Nothing in this tree re-derives those
 * numbers, and they went stale three separate ways inside one release: when
 * three of the four CSS layers below started reaching the editor at all
 * (8ccdcbe), when `scrollContainerCss()` landed (bf171a9), and every time a
 * fixture's own content changes — the user guide IS a fixture, so editing it
 * moves its print count. A measurement no gate re-runs is a measurement that
 * silently becomes wrong, and this one had already been retracted in a commit
 * message while still being quoted in the user guide. If the size of the gap
 * ever has to be a tracked quantity, it needs a committed harness first;
 * until then what is claimed here is the shape of the gap, not its size.
 *
 * The three structural causes:
 *
 * 1. **Sheet-sized elements** (`@page cover { margin: 0 }`, `.gp-bleed`). A
 *    column is the CONTENT box, so an element sized to the full sheet cannot
 *    fit in one and spills into the next. A book of full-bleed art therefore
 *    counts LONG here, where every other cause counts short.
 * 2. **Named pages that resize the page box.** `namedPageDelta()` absorbs a
 *    top-margin-only difference as padding — the design guide's
 *    `@page chapter { margin-top: 2.5in }` is exactly that shape — but a
 *    named page with a different sheet size or bottom margin has no multicol
 *    equivalent and is skipped.
 * 3. **Multicol and paged media avoid breaks differently.** The residual.
 *
 * A fourth cause used to sit alongside those and is now fixed:
 * Chromium treats a scroll container as monolithic in multicol and splits it
 * in print, so every `pre { overflow: hidden }` that straddled a page boundary
 * jumped a page here. `scrollContainerCss()` below is the repair, and the same
 * defect was what made the user guide's preview disagree with its PDF.
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

/** `overflow` values that make a box a scroll container. */
const SCROLLING = /^(hidden|auto|scroll)$/i;

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
    scrollContainerCss(model, opts.root),
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

  // The flow box must be as wide as the ROW it wraps into, not as wide as one
  // page. Multicol L1 §3.4 caps the USED column count at
  // `floor((width + column-gap) / (column-width + column-gap))`, so a box one
  // page wide silently uses ONE column and `column-count: 2` is inert —
  // measured on Chromium 153, the two-column stylesheet laid out
  // byte-identically to the one-column one (same x, same 1080px y pitch), not
  // as a degraded spread. Same formula `viewer.css`'s `.gp-strip[data-wrap]`
  // uses, and it collapses to `contentW` at `columns: 1`, so the single-page
  // path is unchanged.
  const flowW = contentW * columns + colGap * (columns - 1);

  return `${root} {
  box-sizing: content-box;
  width: ${px(flowW)};
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
 * How wide the paginated surface lays out, in CSS px.
 *
 * `columns` whole SHEETS side by side plus the visual gutters between them —
 * deliberately NOT the `width:` declaration `paginationCss()` emits, which is
 * the content box only and leaves the page margins outside it. What a caller
 * wants to know is how much room the pages occupy on screen, margins included.
 *
 * The editor renders at 1 CSS px per print px with no zoom of its own, so this
 * is exactly the pane width needed to show `columns` pages without a
 * horizontal scrollbar. Exported so the host can ask before requesting a
 * spread instead of re-deriving page geometry from the stylesheet itself.
 */
export function paginatedWidth(css: string, opts: PaginateOptions = {}): number {
  const { columns = 1, gap = 24 } = opts;
  const { width } = resolvePage(extract(css)).geometry;
  return width * PX_PER_PT * columns + gap * (columns - 1);
}

/**
 * Map the author's forced PAGE breaks onto column breaks.
 *
 * A `break-before: page` is inert inside a multicol box — only column breaks
 * fragment there — so without this the editor ignores every deliberate page
 * break in the book: `@page`, `@chapter` and an `h1 { break-before: page }`
 * theme rule alike all stop starting a page.
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
 * Let the author's scroll containers fragment, the way they fragment in print.
 *
 * A box with `overflow: hidden` is monolithic in a multicol box and splittable
 * in Chromium's print engine (measured on 153; `viewer/fragment.ts`'s
 * `splitScrollContainers` has the full table). `pre { overflow: hidden }` is an
 * ordinary thing for a book to write — it is what stops a wide code block
 * leaving half a page empty — so without this every such block jumps a page in
 * the editor relative to the PDF.
 *
 * The viewer fixes this on the DOM. The editor cannot: mutating ProseMirror's
 * own DOM is precisely the mistake this module's header records, so the
 * equivalent has to be expressible as CSS, which is why `extract()` carries the
 * declarations.
 *
 * ## Why this one layer is not `:where()`
 *
 * Every other rule here is zero-specificity so the author always wins. This
 * one has to WIN over the author's `overflow`, so it repeats their selector
 * under the root and takes the higher specificity deliberately.
 *
 * That is not overriding the author's intent, it is preserving it: they asked
 * for clipping, and they get clipping. `clip` differs from `hidden` only in
 * being unscrollable — which no printed page is — and in not establishing a
 * block formatting context, which the second rule puts back.
 *
 * The `display` half stays at zero specificity on purpose, and the two rules
 * are split for exactly that reason. `flow-root` must beat the UA sheet's
 * `display: block` but lose to any author `display` — clobbering an authored
 * `display: grid` here would be a real layout regression, and `:where()` on
 * both the root and the selector is what prevents it.
 *
 * An `overflow: hidden !important` still wins and still fragments differently;
 * that is rare enough to leave rather than escalate to `!important` ourselves.
 */
export function scrollContainerCss(model: GcpmModel, root = ".gp-editor-page-flow"): string {
  const rules: string[] = [];
  for (const decl of model.scrollContainers) {
    // `overflow` is one or two values (x then y); the longhands name one axis.
    const parts = decl.value.split(/\s+/);
    const axes: string[] = [];
    if (decl.prop === "overflow") {
      if (SCROLLING.test(parts[0] ?? "")) axes.push("overflow-x");
      if (SCROLLING.test(parts[1] ?? parts[0] ?? "")) axes.push("overflow-y");
    } else if (SCROLLING.test(parts[0] ?? "")) {
      axes.push(decl.prop);
    }
    if (axes.length === 0) continue;
    rules.push(`${root} ${decl.selector} { ${axes.map((a) => `${a}: clip;`).join(" ")} }`);
    rules.push(`:where(${root}) :where(${decl.selector}) { display: flow-root; }`);
  }
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
 * `@page chapter { margin-top: 2.5in }` is exactly this shape, and it applies
 * to every chapter opening in that book.
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
