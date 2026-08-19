/**
 * LIVE-DOCUMENT pagination — the engine's editing mode.
 *
 * The print path fragments a FINISHED document (`fragment.ts`, next door);
 * this module paginates a document that is BEING EDITED, with nothing but a
 * stylesheet, so it can sit under a ProseMirror surface whose DOM must never
 * be mutated from outside. It lives in the engine so the two ways Gutterpress
 * lays out pages are one codebase, not an engine and a copy: the editing
 * surface reads the same `@page` geometry, break declarations and page
 * assignments through the same extractor the PDF path uses, and a change to
 * either is made next to the other. The desktop consumes it through
 * `gutterpress/render` and keeps no pagination logic of its own.
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
 * ## What the two-page view is, and what it deliberately is not
 *
 * Two page boxes side by side at print size. It is NOT a modelled spread: it
 * does not claim which side of the gutter a page falls on, because the editor
 * shows ONE FILE and cannot know where that file starts in the book. A leading
 * empty column slot (`::before { break-after: column }`) would shift page 1 to
 * the right where a printed book puts it — and was written, and is removed
 * again — but it is only correct for a file whose first page is a RECTO. The
 * user guide's chapters carry `break-before: page`, not `recto`, so a chapter
 * begins on whichever page the previous file happened to end before: odd or
 * even by arithmetic, not by rule. Guessing "recto" is wrong for about half the
 * book, and wrong in the most misleading way, since the pairs LOOK authoritative.
 *
 * The preview, which paginates the whole book, is where facing-page fidelity
 * lives (`applySpreadMode` in `engine/viewer/fragment.ts` shifts a run only
 * when `strip.offset % 2 === 0`). If the editor is ever to pair pages the way
 * print does, it needs the file's first PRINT page as an input — the preview
 * knows it — and must fall back to no shift when there is no preview running.
 * Until then this view sizes and typesets two pages at once; it does not
 * position them in a book.
 *
 * A fourth cause used to sit alongside those and is now fixed:
 * Chromium treats a scroll container as monolithic in multicol and splits it
 * in print, so every `pre { overflow: hidden }` that straddled a page boundary
 * jumped a page here. `scrollContainerCss()` below is the repair, and the same
 * defect was what made the user guide's preview disagree with its PDF.
 */
import { extract, mediaPrintBodies, resolvePage } from "../shared/gcpm-extract";
import type { GcpmModel, PageGeometry } from "../shared/gcpm-extract";

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

/**
 * The stylesheet a frame is currently carrying, and what it was derived from.
 *
 * Returned by `nextEditorSheet()` and handed straight back to it next time, so
 * the "has anything actually changed" decision — the one an already-mounted
 * editor's Two-page button depends on — is a pure function of two values
 * rather than component state nothing can test.
 */
export interface EditorSheet {
  /** The book CSS this was built from. */
  css: string;
  /** Columns actually used — never more than `availablePx` fits. */
  columns: 1 | 2;
  /**
   * Width a two-page spread of THIS css needs, in CSS px; 0 when there is no
   * geometry to fit against. Carried rather than recomputed because
   * `paginatedWidth()` parses the whole stylesheet — a couple of milliseconds
   * against a 16ms resize frame, on a question the splitter drag asks on every
   * one of them. (No byte count here on purpose: this file's own header
   * retracts a table of measurements that went stale three ways in one release,
   * and nothing re-derives a stylesheet's size either.)
   */
  spreadPx: number;
  /** The text to put in the frame's `<style>`. */
  text: string;
}

/**
 * The smallest scale the EDITING surface may shrink to before it stops being
 * a place you can write.
 *
 * The editor fits itself to the pane with a visual transform, so a spread
 * always "fits" in the geometric sense — but fitting a two-page spread into
 * the default 42% split renders this book's 10pt body face at 4.3 CSS px
 * (measured, design-guide at 1500x1000). That is not a small editor, it is an
 * unusable one; the same pane shows one page at 8.8px, twice the size.
 *
 * So a spread REQUEST is honoured only while it stays above this floor —
 * which is the original "a 2 is a request, not a guarantee" rule with a
 * threshold that serves legibility instead of demanding 1:1 print size. Below
 * the floor the surface shows the most pages it can render legibly, which is
 * never fewer than one (there is nothing smaller to fall back to, and a pane
 * too narrow even for that is the author's cue to widen it or hide the
 * preview).
 */
export const MIN_LEGIBLE_SCALE = 0.6;

/**
 * The stylesheet the frame should carry now, or `null` when it already has it.
 *
 * Three inputs decide it: the book's CSS, how many pages the app asked for,
 * and how much room the frame has. The surface fits itself to the pane with a
 * VISUAL transform (`RichEditor.applyScale`), so the width test is no longer
 * "does a spread fit at print size" — it is "would a spread still be
 * readable", `MIN_LEGIBLE_SCALE` above.
 *
 * With no book CSS there is no page geometry to fit against, so the honest
 * answer is one column.
 */
export function nextEditorSheet(
  applied: EditorSheet | null,
  css: string,
  requested: 1 | 2,
  availablePx: number,
): EditorSheet | null {
  const sameCss = applied?.css === css;
  const spreadPx = sameCss ? applied!.spreadPx : css ? paginatedWidth(css, { columns: 2 }) : 0;
  const columns: 1 | 2 =
    requested === 2 && spreadPx > 0 && availablePx / spreadPx >= MIN_LEGIBLE_SCALE ? 2 : 1;
  if (sameCss && applied!.columns === columns) return null;
  return { css, columns, spreadPx, text: `${css}\n\n${editorStylesheet(css, { columns })}` };
}

const px = (pt: number) => `${Math.round(pt * PX_PER_PT * 1000) / 1000}px`;

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

  // The SHEETS behind the flow. Each page's paper is painted by the scale
  // wrapper's ::before — repeating vertical white bands one page-pitch apart,
  // one band-column per page abreast — so the author sees page edges without
  // a single wrapper element entering the content flow (fragmentation stays
  // exactly the multicol layout above). Geometry is shared with the flow by
  // construction: band height = page height, band pitch = page height + the
  // visual gutter, band x-offsets = page width + gutter.
  const pageW = geometry.width;
  const pageH = geometry.height;
  // Each band ends in a hairline, so the author can SEE where the page ends.
  // The preview gives every sheet `box-shadow: 0 2px 12px …`; a background
  // band cannot carry a per-band shadow, and without the line the sheets are
  // invisible whenever the canvas is light — which is the default for a book
  // whose `appearance.previewBg` is pale, and reads as "the editor has no
  // pages" (observed on the design guide).
  const edgePt = 2 / PX_PER_PT;
  const band =
    `repeating-linear-gradient(to bottom, var(--gp-editor-sheet, #ffffff) 0 ${px(pageH)}, ` +
    `var(--gp-editor-sheet-edge, rgb(0 0 0 / 0.28)) ${px(pageH)} ${px(pageH + edgePt)}, ` +
    `transparent ${px(pageH + edgePt)} ${px(pageH + gap / PX_PER_PT)})`;
  const bands = Array.from({ length: columns }, () => band).join(", ");
  const positions = Array.from({ length: columns }, (_, i) =>
    `${px(i * (pageW + gap / PX_PER_PT))} 0`,
  ).join(", ");
  const sizes = Array.from({ length: columns }, () => `${px(pageW)} 100%`).join(", ");

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
}

/* The scale wrapper (see RichEditor.svelte): hosts the sheet backdrop and the
   fit-width transform. flow-root so the flow's own margins stay INSIDE it —
   collapsed-out margins would slide the sheets off the pages. The transform
   is applied inline by the host and is VISUAL ONLY: layout inside is at print
   size, so pagination cannot move. */
.gp-editor-scale {
  position: relative;
  display: flow-root;
  width: max-content;
  transform-origin: 0 0;
}
.gp-editor-scale::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image: ${bands};
  background-position: ${positions};
  background-size: ${sizes};
  background-repeat: no-repeat;
  box-shadow: none;
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
 * How far to scale the paginated surface so it sits in the pane, given the
 * author's zoom choice.
 *
 * ## Fit-width NEVER magnifies
 *
 * The whole promise of this surface is that the text is the size it will
 * print. `frameW / flowW` alone breaks that promise in the common case, and
 * breaks it worst for the books this tool is FOR: a 5.5x8.5in digest laid
 * out in a 1900px window computes 2.0, so 11pt body type paints at 22pt and
 * a page is taller than the viewport — the author scrolls through a giant
 * mock-up of their book and never sees a page edge. Measured on a real
 * field guide, and it is why that book looked nothing like its own preview.
 *
 * So fit-width means "shrink until it fits", never "grow to fill". Wider
 * pane than page: the pages stay at print size and are centred. This is the
 * one direction the author cannot get any other way — a page too wide for
 * the pane is unreadable, a page smaller than the pane is just a page.
 *
 * An explicit numeric zoom is the author overriding that on purpose, so it
 * is honoured in both directions, over the same 25%-400% range the preview
 * offers. `MIN_LEGIBLE_SCALE` does not apply here: it governs whether a
 * SPREAD is worth showing at all (see `nextEditorSheet`), while this floor
 * is only the point past which shrinking stops helping.
 */
export function editorScale(frameW: number, flowW: number, zoom = "fit-width"): number {
  if (!(frameW > 0) || !(flowW > 0)) return 1;
  if (zoom !== "fit-width") {
    const requested = Number(zoom);
    return Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(requested, 0.25), 4)
      : 1;
  }
  return Math.min(Math.max(frameW / flowW, 0.2), 1);
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
    // The shorthand's one-or-two-value grammar is resolved ONCE, by
    // `extract()` — the decl carries its axes, so this used to be a second
    // copy of that grammar (and of the scrolling-value regex) that had to
    // agree with the model's across two packages.
    rules.push(`${root} ${decl.selector} { ${decl.axes.map((a) => `${a}: clip;`).join(" ")} }`);
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
