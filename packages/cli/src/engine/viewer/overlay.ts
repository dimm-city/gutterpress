/**
 * Margin & bleed overlay (viewer chrome — PERMANENT tooling, not a shim).
 *
 * An author-facing review aid: while it is on, every page in the preview shows
 * the margin box (dashed) and the bleed band outside the trim (translucent),
 * and any element whose box leaves the content area is outlined — amber when it
 * reaches into the margin, red when it crosses the trim into the bleed or off
 * the page. Art the author placed on purpose (`.gp-bleed`, `.gp-pin`,
 * `.gp-flush`, `.gp-behind`) is outlined softly in violet and not counted.
 *
 * What it reads (never invents):
 *  - page size and margins: the run's own content frame — `StripInfo.geometry`
 *    from `runPageBox()`, i.e. the SAME resolved `@page` (incl. `:left`/`:right`
 *    mirroring and named pages) the columns are sized from, with `.gp-flush`
 *    edges freed exactly as `buildStrips()` frees them. The outline is drawn
 *    where the preview really lays the text, so what you see is what is
 *    classified. The preview keeps ONE text column per run (see decorate.ts's
 *    note on mirrored margins), so on a mirrored-margin book a verso's text
 *    sits where the recto's would; the column WIDTH is the PDF's. Where a
 *    page's own `@page :left`/`:right` margins sit somewhere else, they are
 *    drawn too, as a faint dotted outline — the PDF's contract for that page.
 *  - bleed: `pageGeometry()`, the compiler's own resolution — the document's
 *    base `@page { bleed }` (a named page's `bleed` is ignored by print too).
 *
 * How it looks is set in ONE place — the `--gp-ov-*` tokens at the top of the
 * overlay section of viewer.css. The app lets a user change the colour and a
 * three-step strength (see `OverlayStyle`); both only set a token on <body>,
 * so no author CSS is involved and nothing needs to repaint.
 *
 * What it never does: it adds no box to author content and no class or
 * attribute to author elements. Everything is absolutely-positioned,
 * pointer-transparent chrome in one sibling layer (`.gp-ov`) per run, outside
 * the multicol strip, so pagination is untouched (a test measures page counts
 * with the overlay off and on). The layer only exists while the overlay is on,
 * is hidden for `@media print`, and is never part of a built PDF or of a
 * published page that does not turn it on.
 *
 * Removal: delete this file, the `.gp-ov*` section of viewer.css, and the
 * `setOverlay` hook in decorate.ts. Nothing else depends on it.
 */
import type { GcpmModel, PageGeometry } from "../shared/gcpm-extract.ts";
import { pageGeometry } from "../compiler/tier2.ts";
import {
  PX_PER_PT,
  cssZoomOf,
  indexInStrip,
  type StripInfo,
} from "./fragment.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three nested boxes of one page, in one unit, origin at the trim's top-left. */
export interface PageBoxes {
  /** the cut page */
  trim: Rect;
  /** the area text is laid out in (trim minus margins) */
  content: Rect;
  /** trim grown by the bleed on every side; equals `trim` when there is none */
  bleedBox: Rect;
  bleed: number;
}

/** The document's bleed in pt — what the print path will extend every page by. */
export function documentBleedPt(model: GcpmModel): number {
  return pageGeometry(model, { model }).bleed;
}

/**
 * Boxes for one page. `scale` converts pt to the caller's unit (PX_PER_PT for
 * CSS px). `margin` is the content frame — pass the run's (possibly flushed)
 * margins, not necessarily `g.margin`.
 */
export function pageBoxes(
  g: Pick<PageGeometry, "width" | "height">,
  margin: PageGeometry["margin"],
  bleed: number,
  scale = 1,
): PageBoxes {
  const w = g.width * scale;
  const h = g.height * scale;
  const b = Math.max(0, bleed) * scale;
  return {
    trim: { x: 0, y: 0, w, h },
    content: {
      x: margin.left * scale,
      y: margin.top * scale,
      w: w - (margin.left + margin.right) * scale,
      h: h - (margin.top + margin.bottom) * scale,
    },
    bleedBox: { x: -b, y: -b, w: w + 2 * b, h: h + 2 * b },
    bleed: b,
  };
}

/**
 * Where an element's box sits relative to its page, worst first:
 *  - `inside`   within the content area
 *  - `margin`   leaves the content area but stays on the trimmed page
 *  - `bleed`    crosses the trim but stays inside the bleed band
 *  - `off-page` crosses the outer edge of the bleed band (with no bleed, the
 *               trim): that part is cut off in print
 */
export type OverflowKind = "inside" | "margin" | "bleed" | "off-page";

const SEVERITY: Record<OverflowKind, number> = { inside: 0, margin: 1, bleed: 2, "off-page": 3 };

const within = (r: Rect, outer: Rect, tol: number) =>
  r.x >= outer.x - tol &&
  r.y >= outer.y - tol &&
  r.x + r.w <= outer.x + outer.w + tol &&
  r.y + r.h <= outer.y + outer.h + tol;

/** `tol` absorbs sub-pixel layout (LayoutUnit is 1/64 px) so an exact fit is not flagged. */
export function classifyRect(r: Rect, boxes: PageBoxes, tol = 0): OverflowKind {
  if (within(r, boxes.content, tol)) return "inside";
  if (within(r, boxes.trim, tol)) return "margin";
  if (boxes.bleed > 0 && within(r, boxes.bleedBox, tol)) return "bleed";
  return "off-page";
}

/** The worst of several fragments' kinds (an element split across pages is one element). */
export function worstKind(kinds: readonly OverflowKind[]): OverflowKind {
  return kinds.reduce<OverflowKind>(
    (worst, k) => (SEVERITY[k] > SEVERITY[worst] ? k : worst),
    "inside",
  );
}

/**
 * Art the author placed on purpose — it is EXPECTED to leave the text block,
 * so it is shown softly and never counted as a problem. Core's own vocabulary
 * (gutterpress-css.ts / markers.js): `.gp-bleed` (edge-to-edge plate),
 * `.gp-pin` (+ `.gp-flush`, pinned to the paper edge), `.gp-behind` (art
 * behind the text) and the `@page full-bleed` page.
 */
export const INTENT_SELECTOR = ".gp-bleed, .gp-pin, .gp-flush, .gp-behind, .gp-page-full-bleed";

/**
 * The two knobs a host may turn. They carry no geometry: the viewer maps them
 * onto the `--gp-ov-*` tokens (viewer.css), so "more or less prominent" and
 * "which colour" are the whole vocabulary.
 */
export const OVERLAY_STRENGTHS = ["subtle", "normal", "strong"] as const;
export type OverlayStrength = (typeof OVERLAY_STRENGTHS)[number];
export interface OverlayStyle {
  /** margin box + margin tint colour, `#rgb` / `#rrggbb` */
  color?: string;
  strength?: OverlayStrength;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Whatever a host sent, reduced to values the stylesheet can take; anything else is dropped. */
export function sanitizeOverlayStyle(style: unknown): OverlayStyle {
  const s = (style && typeof style === "object" ? style : {}) as Record<string, unknown>;
  const out: OverlayStyle = {};
  if (typeof s.color === "string" && HEX_COLOR.test(s.color.trim())) out.color = s.color.trim();
  if (OVERLAY_STRENGTHS.includes(s.strength as OverlayStrength)) out.strength = s.strength as OverlayStrength;
  return out;
}

export interface OverlaySummary {
  on: boolean;
  /** elements that leave their content area by accident (counted) */
  issues: number;
  /** intentional art that leaves it on purpose (shown, not counted) */
  intended: number;
  /** the document's bleed in pt (0 = the book defines none) */
  bleedPt: number;
}

export const OVERLAY_OFF: OverlaySummary = { on: false, issues: 0, intended: 0, bleedPt: 0 };

/** Do two margin sets differ enough to draw both? (half a pt: well below anything an author sets) */
export function marginsDiffer(a: PageGeometry["margin"], b: PageGeometry["margin"]): boolean {
  return (["top", "right", "bottom", "left"] as const).some((k) => Math.abs(a[k] - b[k]) > 0.5);
}

/** One drawn page, as `decorate()` knows it. */
export interface OverlayPage {
  /** 0-based, book-wide */
  index: number;
  sheet: HTMLElement;
  strip: StripInfo;
  /** this sheet's own size */
  geometry: PageGeometry;
  /** the margins of the column text is actually laid out in on this page */
  margin: PageGeometry["margin"];
  /** this page's own `@page` margins (`:left`/`:right` resolved) — what the PDF will have */
  printMargin: PageGeometry["margin"];
}

const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "BR", "WBR", "SOURCE", "TRACK", "META"]);
/** Sub-pixel tolerance, in CSS px (unscaled). */
const TOL_PX = 1;

function div(cls: string, box?: Rect): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cls;
  if (box) place(el, box);
  return el;
}

function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/** The margin as a REGION: the trim with the content box cut out (even-odd, so exact at any zoom). */
function marginTint(b: PageBoxes): HTMLDivElement {
  const el = div("gp-ov-tint");
  const { x: l, y: t, w, h } = b.content;
  const r = l + w;
  const bt = t + h;
  el.style.clipPath =
    `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
    `${l}px ${t}px, ${l}px ${bt}px, ${r}px ${bt}px, ${r}px ${t}px, ${l}px ${t}px)`;
  return el;
}

export function clearOverlay(): void {
  for (const layer of Array.from(document.querySelectorAll(".gp-ov"))) layer.remove();
}

interface Painted {
  host: HTMLElement;
  boxes: PageBoxes;
  sheet: HTMLElement;
  /** client rect of the sheet, read once, after the layer is in the DOM */
  rect?: DOMRect;
}

interface Flag {
  host: HTMLElement;
  kind: OverflowKind | "intended";
  box: Rect;
}

/**
 * Draw the overlay for `pages` and return what it found. Idempotent: any
 * earlier layer is removed first. Writes only to `.gp-ov` layers.
 */
export function paintOverlay(
  pages: readonly OverlayPage[],
  strips: readonly StripInfo[],
  bleedPt: number,
): OverlaySummary {
  clearOverlay();
  const layers = new Map<Element, HTMLElement>();
  const painted = new Map<number, Painted>();

  for (const p of pages) {
    const run = p.sheet.closest(".gp-run");
    if (!run) continue;
    let layer = layers.get(run);
    if (!layer) {
      layer = div("gp-ov");
      run.appendChild(layer);
      layers.set(run, layer);
    }
    const boxes = pageBoxes(p.geometry, p.margin, bleedPt, PX_PER_PT);
    const host = div("gp-ov-page", boxes.trim);
    host.style.left = p.sheet.style.left;
    host.style.top = p.sheet.style.top;
    host.dataset.page = String(p.index + 1);
    if (boxes.bleed > 0) {
      const band = div("gp-ov-bleed");
      band.style.inset = `${-boxes.bleed}px`;
      band.style.borderWidth = `${boxes.bleed}px`;
      host.appendChild(band);
      host.appendChild(div("gp-ov-trim"));
    }
    host.appendChild(marginTint(boxes));
    host.appendChild(div("gp-ov-margin", boxes.content));
    if (marginsDiffer(p.printMargin, p.margin)) {
      host.appendChild(div("gp-ov-print", pageBoxes(p.geometry, p.printMargin, 0, PX_PER_PT).content));
    }
    layer.appendChild(host);
    painted.set(p.index, { host, boxes, sheet: p.sheet });
  }

  const flags: Flag[] = [];
  let issues = 0;
  let intended = 0;
  for (const strip of strips) {
    const zoom = cssZoomOf(strip.el);
    // The anchor of a fragment is the middle of its in-column part, so a box
    // that overhangs its column on either side is still attributed to the page
    // it starts on (`indexInStrip` floors a coordinate to a column).
    const colW = (parseFloat(strip.el.style.getPropertyValue("--gp-content-w")) || 0) * zoom;
    const colH = (parseFloat(strip.el.style.getPropertyValue("--gp-content-h")) || 0) * zoom;

    const visit = (el: Element): void => {
      if (SKIP.has(el.tagName) || el.classList.contains("gp-wrap-spacer")) return;
      const kinds: OverflowKind[] = [];
      const found: Flag[] = [];
      for (const r of Array.from(el.getClientRects())) {
        if (r.width <= 0 && r.height <= 0) continue;
        const ax = r.left + Math.min(r.width, colW || r.width) / 2;
        const ay = r.top + Math.min(r.height, colH || r.height) / 2;
        const target = painted.get(strip.offset + indexInStrip(ax, ay, strip));
        if (!target) continue;
        target.rect ??= target.sheet.getBoundingClientRect();
        const local: Rect = {
          x: (r.left - target.rect.left) / zoom,
          y: (r.top - target.rect.top) / zoom,
          w: r.width / zoom,
          h: r.height / zoom,
        };
        const kind = classifyRect(local, target.boxes, TOL_PX);
        kinds.push(kind);
        if (kind !== "inside") found.push({ host: target.host, kind, box: local });
      }
      const worst = worstKind(kinds);
      if (worst !== "inside") {
        // The offender's own box is flagged; its descendants ride along with
        // it, so counting them too would report one cause many times.
        const isIntended = el.closest(INTENT_SELECTOR) !== null;
        if (isIntended) intended++;
        else issues++;
        for (const f of found) flags.push(isIntended ? { ...f, kind: "intended" } : f);
        return;
      }
      for (const child of Array.from(el.children)) visit(child);
    };
    for (const child of Array.from(strip.el.children)) visit(child);
  }

  for (const f of flags) {
    const el = div(`gp-ov-flag`, f.box);
    el.dataset.kind = f.kind;
    f.host.appendChild(el);
  }
  return { on: true, issues, intended, bleedPt: bleedPt };
}
