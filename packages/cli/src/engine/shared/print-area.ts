/**
 * The project's print area: the manifest's `page` block, carried into every
 * assembled book (preview, build, publish) as ONE
 * `<meta name="gp-print-area">` by the markdown assembly
 * (lib/markdown/assemble.ts) and read back here by everything that needs it:
 * the preview's print overlays (viewer/overlay.ts) and both engines' pinned
 * art (pin-edges.ts — a pin sits on the printer's art-safe line). The boxes
 * those numbers draw on a page (`pageBoxes`) and the judge of a piece of ink
 * against them (`judgeRect` / `classifyRect`) live here too, so the overlay
 * and the `pdf.print.safe-margins` check (checks/pdf/safe-margins.ts) read
 * one definition of "safe" — not in a module of their own, because the four
 * numbers mean nothing but those boxes.
 *
 * Only the manifest feeds it — `page.width` x `page.height` (the sheet),
 * `page.bleed` (a bleed the sheet already contains on the top, bottom and
 * OUTER edge; the binding edge has none, as DriveThruRPG cuts it),
 * `page.safe` (the TEXT rule: its inset from the trim on every edge),
 * `page.artSafe` (the ART rule: its inset on the top, bottom and outer edge;
 * absent = `safe`) and `page.gutter` (the binding edge's inset, for text and
 * art alike; absent = `safe`) — plus the preset's id and the printer spec it
 * follows, which only word what the overlay finds.
 * No book or plugin CSS feeds it: not the `@page` margins (they are where the
 * author put the TEXT, which is not the printer's safe area), not
 * `@page { bleed }`.
 *
 * The meta is metadata: it changes nothing a browser renders on its own.
 * Node-safe: the writer is pure, and the reader takes the document it reads.
 */

/** The project's page geometry, in pt — the manifest's `page` block. */
export interface PrintArea {
  width: number;
  height: number;
  /** in-sheet bleed on the top, bottom and outer edge; 0 = none */
  bleed: number;
  /** the TEXT rule: inset from the trim on every edge, the binding edge too unless `gutter` is set; 0 = none */
  safe: number;
  /** the ART rule: inset on the top, bottom and outer edge (the binding edge takes `gutter`) */
  artSafe: number;
  /** the binding allowance: inset from the trim at the binding edge, for text and art alike; absent in the manifest = `safe` */
  gutter: number;
  /** the manifest's preset id, and the printer spec it follows: they only word what is found */
  preset?: string;
  spec?: { label: string; url: string };
}

/** Which side of the spread a page is: page 1 is a recto, so every odd page is one. */
export type PageSide = "recto" | "verso";

/** What a host knows from its resolved config: the `page` block, the preset and its spec. */
export interface PrintAreaSource {
  width: number;
  height: number;
  bleed?: number;
  safe?: number;
  artSafe?: number;
  gutter?: number;
  /** The margins the manifest sets (pt), written as the book's `@page` margins; absent = the stylesheets'. */
  margin?: { top: number; bottom: number; inside: number; outside: number };
  preset?: string;
  spec?: { label: string; url: string };
}

/**
 * The margin a book prints with when nothing sets one — no `page.margin` in
 * the manifest and no `@page` margin in any stylesheet. The assembly writes
 * it as a plain `@page { margin }` ahead of every stylesheet, so a look's or
 * the book's own margin still wins; without it Chromium would print with its
 * own default (about 0.4in) while the engine's `@page` reader assumes 1in,
 * and the preview and the PDF would paginate differently.
 */
export const DEFAULT_PAGE_MARGIN_PT = 72;

/** A usable point value: finite and positive (a page dimension, an inset). */
export function isPositivePoints(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Round to 3dp so 8.27in doesn't print as 8.270000000000001in. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** CSS length for a point value: inches when exact to 3dp (612 -> 8.5in), else points. */
export function cssLength(pt: number): string {
  const inches = round3(pt / 72);
  return Math.abs(inches * 72 - pt) < 1e-6 ? `${inches}in` : `${round3(pt)}pt`;
}

/**
 * The `size` value written for a page — `8.5in 11in`, `595pt 842pt` — by
 * everything that writes one: Book setup (lib/page-size.ts) into the
 * book's stylesheet, and the assembly's manifest default
 * (lib/markdown/assemble.ts), so one size has one spelling.
 */
export function formatPageSize(page: { width: number; height: number }): string {
  return `${cssLength(page.width)} ${cssLength(page.height)}`;
}

/**
 * The `<meta>` tag for one book. An unset bleed or text rule is written as 0,
 * never left out; an unset art rule or gutter stays out (the reader takes each
 * as `safe`).
 * Anything else the config's `page` block holds (`tolerance`) is not part of it.
 */
export function printAreaMeta(page: PrintAreaSource): string {
  const area = JSON.stringify({
    width: page.width,
    height: page.height,
    bleed: page.bleed ?? 0,
    safe: page.safe ?? 0,
    artSafe: page.artSafe,
    gutter: page.gutter,
    preset: page.preset,
    spec: page.spec,
  });
  // single-quoted attribute: escape what could end it or read as an entity
  return `<meta name="gp-print-area" content='${area.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'>`;
}

/** The one DOM call the reader makes: a `Document` satisfies it. */
export interface MetaDocument {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
}

/** The book's print area from its `<meta name="gp-print-area">`; `null` without one. */
export function printAreaFromMeta(doc: MetaDocument): PrintArea | null {
  const raw = doc.querySelector('meta[name="gp-print-area"]')?.getAttribute("content");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PrintArea>;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
    if (!n(v.width) || !n(v.height)) return null;
    const safe = n(v.safe);
    // the spec becomes a link in the legend: only a web address is one
    const spec =
      v.spec && typeof v.spec.label === "string" && typeof v.spec.url === "string" && /^https?:\/\//i.test(v.spec.url)
        ? v.spec
        : undefined;
    return {
      width: n(v.width),
      height: n(v.height),
      bleed: n(v.bleed),
      safe,
      artSafe: typeof v.artSafe === "number" ? n(v.artSafe) : safe,
      gutter: typeof v.gutter === "number" ? n(v.gutter) : safe,
      preset: typeof v.preset === "string" ? v.preset : undefined,
      spec,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The boxes a print area draws on one page, and where a piece of ink stands
// against them. Pure geometry in whatever unit the caller scales to (pt for a
// PDF, px for the viewer), origin at the sheet's top-left, y down.
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The nested boxes of one page, in one unit, origin at the sheet's top-left. */
export interface PageBoxes {
  /** the whole sheet (the bleed box when the sheet contains a bleed) */
  sheet: Rect;
  /** the cut page */
  trim: Rect;
  /** where TEXT is safe from the cut: the trim inset by `safe`, and by `gutter` at the binding */
  safe: Rect;
  /** where ART is safe from the cut: the trim inset by `artSafe`, and by `gutter` at the binding */
  safeArt: Rect;
  bleed: number;
}

/**
 * Boxes for one page. The trim is the sheet pulled in by `bleed` on the top,
 * bottom and OUTER edge — the right edge of a recto, the left edge of a verso;
 * the binding edge has no bleed. The text box is the trim pulled in by `safe`
 * on the top, bottom and outer edge and by `gutter` on the binding edge (left
 * of a recto, right of a verso); the art box is pulled in by `artSafe` on the
 * top, bottom and outer edge and by `gutter` on the binding edge.
 */
export function pageBoxes(area: PrintArea, side: PageSide, scale = 1): PageBoxes {
  const w = area.width * scale;
  const h = area.height * scale;
  const b = Math.max(0, area.bleed) * scale;
  const s = Math.max(0, area.safe) * scale;
  const a = Math.max(0, area.artSafe) * scale;
  const g = Math.max(0, area.gutter) * scale;
  const [textLeft, textRight] = side === "verso" ? [s, g] : [g, s];
  const [artLeft, artRight] = side === "verso" ? [a, g] : [g, a];
  const trim = { x: side === "verso" ? b : 0, y: b, w: Math.max(0, w - b), h: Math.max(0, h - 2 * b) };
  return {
    sheet: { x: 0, y: 0, w, h },
    trim,
    safe: {
      x: trim.x + textLeft,
      y: trim.y + s,
      w: Math.max(0, trim.w - textLeft - textRight),
      h: Math.max(0, trim.h - 2 * s),
    },
    safeArt: {
      x: trim.x + artLeft,
      y: trim.y + a,
      w: Math.max(0, trim.w - artLeft - artRight),
      h: Math.max(0, trim.h - 2 * a),
    },
    bleed: b,
  };
}

/**
 * Where a piece of ink sits relative to its page, worst first:
 *  - `inside`   within the box its rule allows
 *  - `unsafe`   leaves that box but stays on the trimmed page
 *  - `bleed`    crosses the trim but stays on the sheet (in the bleed band)
 *  - `off-page` crosses the sheet's edge: that part is not printed at all
 */
export type OverflowKind = "inside" | "unsafe" | "bleed" | "off-page";

/** The rule a piece of ink is judged by: text against `page.safe`, art against `page.artSafe`. */
export type OverflowRule = "text" | "art";

/** One edge of a page as drawn: `left` and `right` are the page's own, so the binding is a recto's left and a verso's right. */
export type PageEdge = "left" | "right" | "top" | "bottom";

/** The verdict on a piece of ink: see `judgeRect`. */
export interface Overflow {
  kind: OverflowKind;
  gap: number;
  need: number;
}

const SEVERITY: Record<OverflowKind, number> = { inside: 0, unsafe: 1, bleed: 2, "off-page": 3 };

/**
 * Judge one rect of ink, edge by edge, against the box its rule allows (text:
 * `boxes.safe`; art: `boxes.safeArt`). `kind` is the worst edge's and `edge`
 * names it (`null` when the ink is inside). `gap` is how far that edge sits
 * inside the trim (negative = past it) and `need` how far inside the rule
 * wants it, in the boxes' unit. Art that runs out to the sheet's edge is
 * bleeding there, as it should, so that edge passes. `tol` absorbs sub-pixel
 * layout (LayoutUnit is 1/64 px) and PDF rounding so an exact fit is not flagged.
 */
export function judgeRect(r: Rect, boxes: PageBoxes, rule: OverflowRule, tol = 0): Overflow & { edge: PageEdge | null } {
  const { sheet, trim } = boxes;
  const safe = rule === "art" ? boxes.safeArt : boxes.safe;
  // each side as [its name, the ink's edge, the rule's, the trim's, the sheet's], read outward
  const sides = [
    ["left", -r.x, -safe.x, -trim.x, -sheet.x],
    ["right", r.x + r.w, safe.x + safe.w, trim.x + trim.w, sheet.x + sheet.w],
    ["top", -r.y, -safe.y, -trim.y, -sheet.y],
    ["bottom", r.y + r.h, safe.y + safe.h, trim.y + trim.h, sheet.y + sheet.h],
  ] as const;
  let worst: Overflow & { edge: PageEdge | null } = { kind: "inside", gap: 0, need: 0, edge: null };
  let beyond = 0;
  for (const [edge, ink, limit, trimEdge, sheetEdge] of sides) {
    const past = ink - limit;
    if (past <= tol || (rule === "art" && ink >= sheetEdge - tol)) continue;
    const kind: OverflowKind = ink > sheetEdge + tol ? "off-page" : ink > trimEdge + tol ? "bleed" : "unsafe";
    if (SEVERITY[kind] > SEVERITY[worst.kind] || (kind === worst.kind && past > beyond)) {
      worst = { kind, gap: trimEdge - ink, need: trimEdge - limit, edge };
      beyond = past;
    }
  }
  return worst;
}

/** `judgeRect` without the edge: the verdict the overlay paints. */
export function classifyRect(r: Rect, boxes: PageBoxes, rule: OverflowRule, tol = 0): Overflow {
  const { kind, gap, need } = judgeRect(r, boxes, rule, tol);
  return { kind, gap, need };
}
