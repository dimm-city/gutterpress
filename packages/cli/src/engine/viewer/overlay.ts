/**
 * Print overlays (viewer chrome — PERMANENT tooling, not a shim).
 *
 * An author-facing review aid of four independent layers, each with its own
 * colour, its own toggle and its own row in the legend, so every line on the
 * page says what it is:
 *  - `bleed`    the bleed band (translucent) and the trim line;
 *  - `safe`     the printer's TEXT safe line (dashed), the band between it and
 *               the trim tinted, and every flag raised on text;
 *  - `art`      the printer's ART safe line (dotted) and every flag raised on
 *               art;
 *  - `margins`  the page's own content box, the sheet inset by that page's
 *               `@page` margins, as a thin solid line. It is the BOOK's
 *               choice, not the printer's, and the legend says so.
 *
 * The two safe layers judge the book's INK against the rule that applies to
 * it, the way the printer does, each judging only its own: `safe` each line of
 * text (a text node's glyph rects) against the TEXT box; `art` images, media
 * and any box that paints (a background or a border) against the ART box, edge
 * by edge — an edge that runs out to the sheet's edge is a bleed done right and
 * passes. A container that paints nothing is never flagged, only what it
 * holds, and page furniture (folios, running heads) is judged the same way. A
 * flag is amber when the ink stays on the trimmed page, red when it crosses
 * the trim into the bleed or off the sheet. Art the author placed on purpose
 * (`.gp-bleed`, `.gp-pin`, `.gp-flush`, `.gp-behind`) is outlined softly in
 * violet and not counted. With a layer off nothing of its rule is judged: no
 * flags, and no count.
 *
 * WHERE THE GEOMETRY COMES FROM. `bleed`, `safe` and `art`: the project's
 * manifest and its preset, and nothing else — `page.width` x `page.height`
 * (the sheet), `page.bleed` (a bleed the sheet already contains on the top,
 * bottom and OUTER edge; the binding edge has none, as DriveThruRPG cuts it),
 * `page.safe` (the TEXT rule: its inset from the trim on every edge),
 * `page.artSafe` (the ART rule: its inset on the top, bottom and outer edge;
 * absent = `safe`) and `page.gutter` (the binding edge's inset, for text and
 * art alike; absent = `safe`). The markdown assembly
 * hands them in as `<meta name="gp-print-area">` (shared/print-area.ts), with
 * the preset's id and the printer spec it follows, which only word what is
 * found. No book or plugin
 * CSS feeds them: not the `@page` margins (they are where the author put the
 * TEXT, which is not the printer's safe area), not `@page { bleed }`.
 * `margins` is the one layer that IS the book's own CSS, and only its `@page`
 * margins as the viewer resolved them: a recto's are the run's
 * (`strip.geometry.margin`), a verso's swap by `versoShift` (decorate.ts). Each
 * box is anchored on the top-left of the sheet the viewer drew for that page,
 * so it sits on the paper wherever the paper is.
 *
 * WHERE IT IS DRAWN: one `<gp-overlay>` element on `<html>`, outside `<body>`
 * (the stage the book's CSS styles), with every property that could place,
 * hide or restyle it set inline and `!important`, and all of its content in a
 * shadow root with its own stylesheet and its own tokens. No selector in a
 * book or plugin stylesheet reaches inside, no custom property they set is
 * inherited by it, and it stacks above the whole book. The pages' boxes are
 * mirrored onto the stage's zoom (a paint transform, re-synced when a host
 * changes it) in one canvas; the LEGEND is not in that canvas, so it stays put
 * in the corner of the viewport at any zoom or scroll. The legend names each
 * enabled layer with its values in inches and the edges they apply to, where
 * those numbers come from (the printer's spec as a link, else the manifest),
 * what the safe layers found, and how to hide it, under a header whose
 * button folds all that away. It is the only part that takes the pointer (its
 * link and that button must be clickable).
 *
 * How it looks is set in ONE place — the tokens in `OVERLAY_CSS` below. The app
 * lets a user change each layer's colour and a three-step strength
 * (`OverlayStyle`); both only set a token on the overlay's own root, so
 * nothing repaints.
 *
 * What it never does: it adds no box to author content and no class or
 * attribute to author elements, so pagination is untouched (a test measures
 * page counts with the overlay off and on). It only exists while a layer is
 * on, is hidden for `@media print`, and is never part of a built PDF.
 *
 * Removal: delete this file and the `setOverlay` hook in decorate.ts. Nothing
 * else depends on it.
 */
import { PX_PER_PT, cssZoomOf, indexInStrip, type StripInfo } from "./fragment.ts";
import type { PageSide, PrintArea } from "../shared/print-area.ts";

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

const SEVERITY: Record<OverflowKind, number> = { inside: 0, unsafe: 1, bleed: 2, "off-page": 3 };

/**
 * Judge one rect of ink, edge by edge, against the box its rule allows (text:
 * `boxes.safe`; art: `boxes.safeArt`). `kind` is the worst edge's. `gap` is how
 * far that edge sits inside the trim (negative = past it) and `need` how far
 * inside the rule wants it, in the boxes' unit. Art that runs out to the
 * sheet's edge is bleeding there, as it should, so that edge passes. `tol`
 * absorbs sub-pixel layout (LayoutUnit is 1/64 px) so an exact fit is not flagged.
 */
export function classifyRect(
  r: Rect,
  boxes: PageBoxes,
  rule: OverflowRule,
  tol = 0,
): { kind: OverflowKind; gap: number; need: number } {
  const { sheet, trim } = boxes;
  const safe = rule === "art" ? boxes.safeArt : boxes.safe;
  // each side as [the ink's edge, the rule's, the trim's, the sheet's], read outward
  const sides = [
    [-r.x, -safe.x, -trim.x, -sheet.x],
    [r.x + r.w, safe.x + safe.w, trim.x + trim.w, sheet.x + sheet.w],
    [-r.y, -safe.y, -trim.y, -sheet.y],
    [r.y + r.h, safe.y + safe.h, trim.y + trim.h, sheet.y + sheet.h],
  ] as const;
  let worst = { kind: "inside" as OverflowKind, gap: 0, need: 0 };
  let beyond = 0;
  for (const [ink, limit, edge, sheetEdge] of sides) {
    const past = ink - limit;
    if (past <= tol || (rule === "art" && ink >= sheetEdge - tol)) continue;
    const kind: OverflowKind = ink > sheetEdge + tol ? "off-page" : ink > edge + tol ? "bleed" : "unsafe";
    if (SEVERITY[kind] > SEVERITY[worst.kind] || (kind === worst.kind && past > beyond)) {
      worst = { kind, gap: edge - ink, need: edge - limit };
      beyond = past;
    }
  }
  return worst;
}

/**
 * Art the author placed on purpose — it is EXPECTED to leave the safe area,
 * so it is shown softly and never counted as a problem. Core's own vocabulary
 * (gutterpress-css.ts / markers.js): `.gp-bleed` (edge-to-edge plate),
 * `.gp-pin` (+ `.gp-flush`, pinned to the paper edge), `.gp-behind` (art
 * behind the text) and the `@page full-bleed` page.
 */
export const INTENT_SELECTOR = ".gp-bleed, .gp-pin, .gp-flush, .gp-behind, .gp-page-full-bleed";

/** The four layers a host may turn on and off, each independently. */
export const OVERLAY_LAYERS = ["bleed", "safe", "art", "margins"] as const;
export type OverlayLayer = (typeof OVERLAY_LAYERS)[number];
export type OverlayLayers = Record<OverlayLayer, boolean>;

/** `true` / `false` set all four layers; an object names the ones that are on (a layer it leaves out is off). */
export function layersFrom(state: unknown): OverlayLayers {
  const named = state && typeof state === "object" ? (state as Record<string, unknown>) : null;
  const on = (layer: OverlayLayer) => (named ? named[layer] === true : !!state);
  return { bleed: on("bleed"), safe: on("safe"), art: on("art"), margins: on("margins") };
}

/**
 * The knobs a host may turn besides the layers. They carry no geometry: the
 * overlay maps them onto its own tokens, so "more or less prominent" and
 * "which colour, per layer" are the whole vocabulary.
 */
export const OVERLAY_STRENGTHS = ["subtle", "normal", "strong"] as const;
export type OverlayStrength = (typeof OVERLAY_STRENGTHS)[number];
export interface OverlayStyle {
  /** alias of `colors.safe` */
  color?: string;
  /** each layer's colour, `#rgb` / `#rrggbb` */
  colors?: Partial<Record<OverlayLayer, string>>;
  strength?: OverlayStrength;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Whatever a host sent, reduced to values the stylesheet can take (`color` folded into `colors.safe`); anything else is dropped. */
export function sanitizeOverlayStyle(style: unknown): OverlayStyle {
  const s = (style && typeof style === "object" ? style : {}) as Record<string, unknown>;
  const given = (s.colors && typeof s.colors === "object" ? s.colors : {}) as Record<string, unknown>;
  const hex = (v: unknown) => (typeof v === "string" && HEX_COLOR.test(v.trim()) ? v.trim() : undefined);
  const out: OverlayStyle = {};
  for (const layer of OVERLAY_LAYERS) {
    const color = hex(given[layer]) ?? (layer === "safe" ? hex(s.color) : undefined);
    if (color) (out.colors ??= {})[layer] = color;
  }
  if (OVERLAY_STRENGTHS.includes(s.strength as OverlayStrength)) out.strength = s.strength as OverlayStrength;
  return out;
}

export interface OverlaySummary {
  on: boolean;
  /** the layers that are drawn (all false when off) */
  layers: OverlayLayers;
  /** ink that leaves its safe area by accident, as far as the layers that are on judge it: `counts.text + art + bleed + offPage` */
  issues: number;
  /** intentional ink that leaves it on purpose (shown, not counted) */
  intended: number;
  /** the project's in-sheet bleed in pt (0 = none set) */
  bleedPt: number;
  /** the TEXT rule's inset from the trim in pt (0 = none set) */
  safePt: number;
  /** the ART rule's inset on the top, bottom and outer edge in pt (`page.artSafe`, else `safePt`) */
  artSafePt: number;
  /**
   * one per outlined rect: past a safe line on the trimmed page (text, art), in the bleed band, off the sheet, placed
   * on purpose. Only ink whose layer is on is judged: text by `safe`, art by `art`, so the bleed band and off-page
   * counts hold what those layers looked at.
   */
  counts: { text: number; art: number; bleed: number; offPage: number; intended: number };
}

export const OVERLAY_OFF: OverlaySummary = {
  on: false,
  layers: { bleed: false, safe: false, art: false, margins: false },
  issues: 0,
  intended: 0,
  bleedPt: 0,
  safePt: 0,
  artSafePt: 0,
  counts: { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 },
};

/** One drawn page, as `decorate()` knows it. */
export interface OverlayPage {
  /** 0-based, book-wide */
  index: number;
  sheet: HTMLElement;
  strip: StripInfo;
  /** an appended signature-padding page: a plain sheet, with no `@page` margins of its own */
  padded?: boolean;
}

/**
 * Without the project's geometry (a page the markdown assembly did not build), a
 * sheet's own size stands in and there is no bleed or safe area to draw.
 */
function sheetArea(sheet: HTMLElement): PrintArea {
  const px = (name: string) => parseFloat(sheet.style.getPropertyValue(name)) || 0;
  return { width: px("--gp-page-w") / PX_PER_PT, height: px("--gp-page-h") / PX_PER_PT, bleed: 0, safe: 0, artSafe: 0, gutter: 0 };
}

/**
 * The overlay's whole look. Lives in the shadow root, so it is the only CSS
 * that applies there, and its tokens are declared on `.root` itself, so a
 * value a book sets on `:root` or `body` can never be inherited in.
 */
export const OVERLAY_CSS = `
.root {
  --gp-ov-color: #2f80ed;       /* safe layer: the text line + the tint outside it */
  --gp-ov-width: 2px;           /* line width as seen on screen, at any zoom */
  --gp-ov-style: dashed;        /* text safe line style */
  --gp-ov-art-style: dotted;    /* art safe line style */
  --gp-ov-tint: 0.1;            /* opacity of the tint between the text line and the trim */
  --gp-ov-bleed-color: #e5484d; /* bleed layer: the band, and (darker) the trim line */
  --gp-ov-bleed-alpha: 0.45;    /* opacity of the bleed band */
  --gp-ov-trim-color: color-mix(in srgb, var(--gp-ov-bleed-color) 60%, #000); /* darker than the band so it reads as an edge */
  --gp-ov-art-color: #a855f7;   /* art layer: the art line (dotted, a second cue) */
  --gp-ov-margins-color: #1a9c6b; /* margins layer: the page's own content box */
  --gp-ov-flag-width: 2px;      /* overflow flag outline */
  --gp-ov-warn: #f59e0b;        /* leaves the safe area */
  --gp-ov-error: #e5484d;       /* crosses the trim / leaves the sheet */
  --gp-ov-intent: #8b5cf6;      /* placed on purpose */
  /* The overlay is scaled with the stage, so a 2px line would shrink with the
     zoom; dividing by it keeps lines the same width on screen at every zoom. */
  --gp-ov-w: calc(var(--gp-ov-width) / var(--gp-ov-z, 1));
  --gp-ov-flag-w: calc(var(--gp-ov-flag-width) / var(--gp-ov-z, 1));
  --gp-ov-margins-w: calc(1px / var(--gp-ov-z, 1)); /* thin, whatever the strength */
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* the stage's zoomed copy, holding the pages' boxes; the legend sits beside it, not in it */
.gp-ov-canvas {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.root[data-strength="subtle"] {
  --gp-ov-width: 1px;
  --gp-ov-tint: 0.05;
  --gp-ov-bleed-alpha: 0.3;
}
.root[data-strength="strong"] {
  --gp-ov-width: 3px;
  --gp-ov-tint: 0.2;
  --gp-ov-bleed-alpha: 0.65;
  --gp-ov-flag-width: 3px;
}
.gp-ov-page, .gp-ov-tint, .gp-ov-safe, .gp-ov-art, .gp-ov-bleed, .gp-ov-trim, .gp-ov-margins, .gp-ov-flag {
  position: absolute;
  box-sizing: border-box;
}
/* the band between the text line and the trim, as a REGION (clip-path, set in
   overlay.ts), so it reads as an area, not a hairline */
.gp-ov-tint {
  background: color-mix(in srgb, var(--gp-ov-color) calc(var(--gp-ov-tint) * 100%), transparent);
}
.gp-ov-safe {
  border: var(--gp-ov-w) var(--gp-ov-style) var(--gp-ov-color);
}
.gp-ov-art {
  border: var(--gp-ov-w) var(--gp-ov-art-style) var(--gp-ov-art-color);
}
/* bleed: a translucent band between the trim and the sheet edge (its width is the border) */
.gp-ov-bleed {
  border-style: solid;
  border-color: color-mix(in srgb, var(--gp-ov-bleed-color) calc(var(--gp-ov-bleed-alpha) * 100%), transparent);
}
/* trim: where the sheet will be cut, drawn only when there is bleed */
.gp-ov-trim {
  outline: var(--gp-ov-w) solid var(--gp-ov-trim-color);
  outline-offset: calc(-1 * var(--gp-ov-w));
}
/* margins: the page's own content box, a thin solid line */
.gp-ov-margins {
  border: var(--gp-ov-margins-w) solid var(--gp-ov-margins-color);
}
/* overflow flags: outline + faint tint, never a box change */
.gp-ov-flag[data-kind="unsafe"] {
  outline: var(--gp-ov-flag-w) solid var(--gp-ov-warn);
  background: color-mix(in srgb, var(--gp-ov-warn) 16%, transparent);
}
.gp-ov-flag[data-kind="bleed"],
.gp-ov-flag[data-kind="off-page"] {
  outline: var(--gp-ov-flag-w) solid var(--gp-ov-error);
  background: color-mix(in srgb, var(--gp-ov-error) 18%, transparent);
}
.gp-ov-flag[data-kind="intended"] {
  outline: var(--gp-ov-flag-w) dotted var(--gp-ov-intent);
}
/* the legend: small, fixed in a corner of the viewport, and the one part that takes the pointer (its link and its fold button) */
.gp-ov-legend {
  position: fixed;
  right: 12px;
  bottom: 12px;
  box-sizing: border-box;
  max-width: min(420px, calc(100vw - 24px));
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(20, 20, 24, 0.92);
  color: #fff;
  font: 11px/1.45 ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}
.gp-ov-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gp-ov-body { margin-top: 6px; }
.gp-ov-body > div + div { margin-top: 3px; }
.gp-ov-legend a { color: #9cc2ff; }
/* the fold button: a chevron made of two borders, down while the legend is open, up once it is folded to its header */
.gp-ov-toggle {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.gp-ov-toggle:focus-visible { outline: 2px solid #9cc2ff; }
.gp-ov-toggle::before {
  content: "";
  width: 6px;
  height: 6px;
  border: solid currentColor;
  border-width: 0 2px 2px 0;
  transform: translateY(-2px) rotate(45deg);
}
.gp-ov-toggle[aria-expanded="false"]::before { transform: translateY(2px) rotate(-135deg); }
.gp-ov-row { display: flex; align-items: flex-start; gap: 6px; }
.gp-ov-swatch {
  flex: none;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  margin-top: 3px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 2px;
}
.gp-ov-swatch[data-layer="bleed"] { background: var(--gp-ov-bleed-color); }
.gp-ov-swatch[data-layer="safe"] { background: var(--gp-ov-color); }
.gp-ov-swatch[data-layer="art"] { background: var(--gp-ov-art-color); }
.gp-ov-swatch[data-layer="margins"] { background: var(--gp-ov-margins-color); }
.gp-ov-note { opacity: 0.75; }
@media print {
  .root { display: none; }
}
`;

/**
 * The host element's own declarations, all inline `!important`: an inline
 * important declaration outranks any author rule, important or not, so no
 * stylesheet can hide, move, clip or restyle the host. `all: initial` also
 * stops every inherited property at the host.
 */
const HOST_STYLE = [
  "all: initial",
  "display: block",
  "position: absolute",
  "left: 0",
  "top: 0",
  "width: 0",
  "height: 0",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "overflow: visible",
  "visibility: visible",
  "opacity: 1",
  "filter: none",
  "clip-path: none",
  "mask: none",
  "z-index: 2147483647",
  "pointer-events: none",
  "contain: style",
]
  .map((d) => `${d} !important`)
  .join("; ");

export const OVERLAY_TAG = "gp-overlay";

let host: HTMLElement | null = null;
let root: HTMLElement | null = null;
/** the zoomed layer inside `root` that the pages' boxes are drawn in */
let canvas: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let currentStyle: OverlayStyle = {};

/** The token each layer's colour sets on the root (`--gp-ov-color` is the safe layer's, as it was before there were layers). */
const COLOR_TOKEN: Record<OverlayLayer, string> = {
  bleed: "--gp-ov-bleed-color",
  safe: "--gp-ov-color",
  art: "--gp-ov-art-color",
  margins: "--gp-ov-margins-color",
};

function applyStyle(): void {
  if (!root) return;
  if (currentStyle.strength) root.dataset.strength = currentStyle.strength;
  for (const layer of OVERLAY_LAYERS) {
    const color = currentStyle.colors?.[layer];
    if (color) root.style.setProperty(COLOR_TOKEN[layer], color);
  }
}

/** Remember the look and apply it to a showing overlay; no repaint. */
export function setOverlayStyle(style: OverlayStyle): void {
  currentStyle = { ...currentStyle, ...style, colors: { ...currentStyle.colors, ...style.colors } };
  applyStyle();
}

/** The stage's (`<body>`) zoom and on-screen origin. */
function stageFrame(): { left: number; top: number; zoom: number } {
  const stage = document.body;
  const r = stage.getBoundingClientRect();
  const zoom = stage.offsetWidth > 0 ? r.width / stage.offsetWidth : 1;
  return { left: r.left, top: r.top, zoom: zoom || 1 };
}

/** Line the canvas up with the stage: same origin, same zoom. */
function syncToStage(): void {
  if (!root || !canvas) return;
  const { left, top, zoom } = stageFrame();
  canvas.style.transform = `translate(${left + window.scrollX}px, ${top + window.scrollY}px) scale(${zoom})`;
  root.style.setProperty("--gp-ov-z", String(zoom));
}

/**
 * The overlay's root, created on first use and emptied on every call. Returns
 * the canvas the pages' boxes go in (aria-hidden: they are decoration); the
 * legend is appended to the root beside it, outside the stage's zoom.
 */
function ensureRoot(): HTMLElement {
  if (!(host && root && host.isConnected)) {
    host = document.createElement(OVERLAY_TAG);
    host.setAttribute("style", HOST_STYLE);
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = OVERLAY_CSS;
    root = document.createElement("div");
    root.className = "root";
    shadow.append(sheet, root);
    document.documentElement.appendChild(host);
    applyStyle();
    // A host zooms by setting a custom property on <html> or <body>; the stage
    // is a paint transform, so nothing re-lays out and no redraw follows. Keep
    // the canvas's transform in step with it.
    observer = new MutationObserver(syncToStage);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
  }
  root.textContent = "";
  canvas = div("gp-ov-canvas");
  canvas.setAttribute("aria-hidden", "true");
  root.appendChild(canvas);
  return canvas;
}

export function clearOverlay(): void {
  observer?.disconnect();
  observer = null;
  host?.remove();
  host = null;
  root = null;
  canvas = null;
}

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

/** The band between the text line and the trim, as a region (even-odd, so exact at any zoom). */
function unsafeTint(b: PageBoxes): HTMLDivElement {
  const el = div("gp-ov-tint", b.sheet);
  const t = b.trim;
  const s = b.safe;
  el.style.clipPath =
    `polygon(evenodd, ${t.x}px ${t.y}px, ${t.x + t.w}px ${t.y}px, ${t.x + t.w}px ${t.y + t.h}px, ${t.x}px ${t.y + t.h}px, ${t.x}px ${t.y}px, ` +
    `${s.x}px ${s.y}px, ${s.x}px ${s.y + s.h}px, ${s.x + s.w}px ${s.y + s.h}px, ${s.x + s.w}px ${s.y}px, ${s.x}px ${s.y}px)`;
  return el;
}

/**
 * The page's own content box in px, from the sheet's top-left: the sheet inset
 * by that page's `@page` margins. A recto takes the run's (`strip.geometry`); a
 * verso's left and right swap by `versoShift`, how far the run's text sits to
 * the right of the verso's own left margin (decorate.ts), so the box lands
 * where that page's text does.
 */
function marginsBox(p: OverlayPage, side: PageSide): Rect {
  const { width, height, margin } = p.strip.geometry;
  const shift = side === "verso" ? p.strip.versoShift : 0;
  const left = margin.left - shift;
  const right = margin.right + shift;
  return {
    x: left * PX_PER_PT,
    y: margin.top * PX_PER_PT,
    w: Math.max(0, width - left - right) * PX_PER_PT,
    h: Math.max(0, height - margin.top - margin.bottom) * PX_PER_PT,
  };
}

interface Painted {
  host: HTMLElement;
  boxes: PageBoxes;
  sheet: HTMLElement;
  /** client rect of the sheet, read once */
  rect?: DOMRect;
}

interface Flag {
  host: HTMLElement;
  kind: OverflowKind | "intended";
  rule: OverflowRule;
  box: Rect;
  title: string;
}

/** Sub-pixel tolerance, in CSS px (unscaled). */
const TOL_PX = 1;
const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "BR", "WBR", "SOURCE", "TRACK", "META"]);
/** Elements whose own pixels are art, whatever their style says. (Not `picture`: it paints nothing, its `img` does.) */
const ART_TAGS = new Set(["img", "svg", "video", "canvas"]);
/** CSS px to inches, as a number that reads without trailing zeros. */
const inches = (px: number) => +(Math.abs(px) / 96).toFixed(2);
/** pt to inches, as the legend words a rule ("0.125in"). */
const ptIn = (pt: number) => `${+(pt / 72).toFixed(3)}in`;

/** `localStorage` key for whether the legend is folded. */
const LEGEND_FOLD_KEY = "gutterpress.overlay-legend-collapsed";

/**
 * Whether the legend is folded to its header. It is module state because the
 * legend is rebuilt on every paint, and it is mirrored to `localStorage` so a
 * reload of the preview keeps it. Storage is only a convenience: where it is
 * blocked the legend still folds, for as long as the page lives.
 */
let legendCollapsed = false;
try {
  legendCollapsed = localStorage.getItem(LEGEND_FOLD_KEY) === "true";
} catch {
  // storage is blocked: the legend starts open
}

/**
 * The legend, in the root beside the canvas: a header (the title and a button
 * that folds the rest away) over one row per enabled layer (swatch, name, its
 * values in inches and the edges they apply to), where the numbers come from,
 * what the `safe` layer found, and — when the host binds a key for it
 * (`<html data-overlay-key>`) — how to hide it. Everything is set as text; the
 * only markup is the spec's link and the button.
 */
function legend(layers: OverlayLayers, area: PrintArea | null, summary: OverlaySummary): HTMLElement {
  const el = div("gp-ov-legend");
  const body = div("gp-ov-body");
  body.id = "gp-ov-body";
  const add = (cls: string, ...content: Array<string | Node>) => {
    const line = div(cls);
    line.append(...content);
    body.appendChild(line);
  };
  const row = (layer: OverlayLayer, name: string, text: string) => {
    const swatch = div("gp-ov-swatch");
    swatch.dataset.layer = layer;
    const bold = document.createElement("b");
    bold.textContent = name;
    const label = document.createElement("span");
    label.append(bold, text);
    add("gp-ov-row", swatch, label);
  };
  const { bleedPt, safePt, artSafePt, counts } = summary;
  // the binding edge's inset for text and art: `page.gutter`, which is `page.safe` unless the book sets it
  const gutterPt = area?.gutter ?? safePt;
  if (layers.bleed) {
    row(
      "bleed",
      "Bleed",
      bleedPt > 0
        ? ` ${ptIn(bleedPt)} — top, bottom, outside; none at the binding`
        : " — none set (page.bleed in manifest.yaml)",
    );
  }
  if (layers.safe) {
    row(
      "safe",
      "Safe area: text",
      safePt <= 0
        ? " — none set (page.safe in manifest.yaml)"
        : gutterPt === safePt
          ? ` — ${ptIn(safePt)}, every edge`
          : ` — ${ptIn(safePt)}; ${ptIn(gutterPt)} at the binding`,
    );
  }
  if (layers.art) {
    row(
      "art",
      "Safe area: art",
      safePt <= 0 && artSafePt <= 0
        ? " — none set (page.artSafe in manifest.yaml)"
        : artSafePt === gutterPt
          ? ` — ${ptIn(artSafePt)}, every edge`
          : ` — ${ptIn(artSafePt)} top, bottom, outside; ${ptIn(gutterPt)} at the binding`,
    );
  }
  if (layers.margins) row("margins", "Page margins", " — your stylesheet's @page margins");
  if (area && (layers.bleed || layers.safe || layers.art)) {
    if (area.spec) {
      const link = document.createElement("a");
      link.href = area.spec.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = area.spec.label;
      add("gp-ov-note", "from ", link);
    } else {
      add("gp-ov-note", `from manifest.yaml${area.preset ? ` (preset ${area.preset})` : ""}`);
    }
  }
  // the counts hold only what the safe layers that are on judged: text for `safe`, art for `art`
  if (layers.safe || layers.art) {
    const found: string[] = [];
    if (counts.text) found.push(`${counts.text} text outside the safe area`);
    if (counts.art) found.push(`${counts.art} art outside${counts.text ? "" : " the safe area"}`);
    if (counts.bleed) found.push(`${counts.bleed} in the bleed band`);
    if (counts.offPage) found.push(`${counts.offPage} off the page`);
    if (!found.length) {
      found.push(`${layers.safe && layers.art ? "everything" : layers.safe ? "all text" : "all art"} inside the safe area`);
    }
    if (counts.intended) found.push(`${counts.intended} placed on purpose`);
    add("gp-ov-found", found.join(" · "));
  }
  const key = document.documentElement.dataset.overlayKey;
  if (key) add("gp-ov-note", `${key} hides`);

  const title = document.createElement("b");
  title.id = "gp-ov-title";
  title.textContent = "Print overlays";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "gp-ov-toggle";
  toggle.setAttribute("aria-labelledby", title.id);
  toggle.setAttribute("aria-controls", body.id);
  const fold = () => {
    body.hidden = legendCollapsed;
    toggle.setAttribute("aria-expanded", String(!legendCollapsed));
    toggle.title = legendCollapsed ? "Show the legend" : "Hide the legend";
  };
  toggle.addEventListener("click", () => {
    legendCollapsed = !legendCollapsed;
    try {
      localStorage.setItem(LEGEND_FOLD_KEY, String(legendCollapsed));
    } catch {
      // storage is blocked or full: the fold lasts as long as the page
    }
    fold();
  });
  fold();
  const head = div("gp-ov-head");
  head.append(title, toggle);
  el.append(head, body);
  return el;
}

/**
 * Draw the overlay's `layers` for `pages` and return what it found. Idempotent:
 * the previous drawing is replaced. `area` is the project's geometry
 * (`printAreaFromMeta`, shared/print-area.ts); `null` falls back to each
 * sheet's own size. Only
 * the two safe layers judge the book's ink, each its own rule (`safe` text,
 * `art` art): with a layer off there are no flags and no count for its rule.
 */
export function paintOverlay(
  pages: readonly OverlayPage[],
  strips: readonly StripInfo[],
  area: PrintArea | null,
  layers: OverlayLayers,
): OverlaySummary {
  const layer = ensureRoot();
  syncToStage();
  const stage = stageFrame();
  const painted = new Map<number, Painted>();

  for (const p of pages) {
    const side: PageSide = p.sheet.dataset.side === "verso" ? "verso" : "recto";
    const boxes = pageBoxes(area ?? sheetArea(p.sheet), side, PX_PER_PT);
    // The page's box sits on the paper: the sheet's top-left, in the stage's
    // own (unzoomed) coordinates — the overlay root is scaled with the stage.
    const rect = p.sheet.getBoundingClientRect();
    const host = div("gp-ov-page", {
      x: (rect.left - stage.left) / stage.zoom,
      y: (rect.top - stage.top) / stage.zoom,
      w: boxes.sheet.w,
      h: boxes.sheet.h,
    });
    host.dataset.page = String(p.index + 1);
    if (layers.bleed && boxes.bleed > 0) {
      // The band is the sheet minus the trim: a border whose width on each
      // side is how far the trim sits inside it (0 on the binding edge).
      const sh = boxes.sheet;
      const t = boxes.trim;
      const band = div("gp-ov-bleed", sh);
      band.style.borderWidth =
        `${t.y - sh.y}px ${sh.x + sh.w - (t.x + t.w)}px ${sh.y + sh.h - (t.y + t.h)}px ${t.x - sh.x}px`;
      host.appendChild(band);
      host.appendChild(div("gp-ov-trim", t));
    }
    if (layers.safe && area && area.safe > 0) {
      host.appendChild(unsafeTint(boxes));
      host.appendChild(div("gp-ov-safe", boxes.safe));
    }
    // the art line: its own layer, so it is drawn even where it lies on the text line (one rule for both)
    if (layers.art && area && area.artSafe > 0) host.appendChild(div("gp-ov-art", boxes.safeArt));
    if (layers.margins && !p.padded) host.appendChild(div("gp-ov-margins", marginsBox(p, side)));
    layer.appendChild(host);
    painted.set(p.index, { host, boxes, sheet: p.sheet, rect });
  }

  const flags: Flag[] = [];
  const counts = { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 };
  const seen = new Set<string>();
  const range = document.createRange();
  const source = area?.spec?.label ?? "the safe area";

  /**
   * Judge the ink under `root`: with `safe` on, every text node's glyph rects
   * against the text box; with `art` on, images, media and any box that paints
   * (a background or a border) against the art box. A container that paints
   * nothing is never flagged itself, only what it holds. `pageOf` says which
   * page a client rect is on. A rule whose layer is off is not looked at.
   */
  const inspect = (root: Node, pageOf: (r: DOMRect) => Painted | undefined, zoom: number): void => {
    if (!layers.safe && !layers.art) return;
    const judge = (el: Element, rule: OverflowRule, rects: Iterable<DOMRect>): void => {
      for (const r of rects) {
        if (r.width <= 0 && r.height <= 0) continue;
        const target = pageOf(r);
        if (!target) continue;
        target.rect ??= target.sheet.getBoundingClientRect();
        const box: Rect = {
          x: (r.left - target.rect.left) / zoom,
          y: (r.top - target.rect.top) / zoom,
          w: r.width / zoom,
          h: r.height / zoom,
        };
        const { kind, gap, need } = classifyRect(box, target.boxes, rule, TOL_PX);
        if (kind === "inside") continue;
        // the same rect reached twice (a painted box around one image) is one flag
        const key = `${target.host.dataset.page} ${box.x} ${box.y} ${box.w} ${box.h}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // ink under placed art is expected to leave the safe area: shown, not counted
        const placed = el.closest(INTENT_SELECTOR) !== null;
        const bucket = placed ? "intended" : kind === "unsafe" ? rule : kind === "bleed" ? "bleed" : "offPage";
        counts[bucket]++;
        const title = `${rule} ${inches(gap)}in ${gap < 0 ? "past" : "from"} the trim; ${source} needs ${inches(need)}in`;
        flags.push({
          host: target.host,
          kind: placed ? "intended" : kind,
          rule,
          box,
          title: placed ? `${title} (placed on purpose)` : title,
        });
      }
    };
    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!layers.safe || !node.nodeValue?.trim()) return;
        range.selectNodeContents(node);
        judge(node.parentElement!, "text", range.getClientRects());
        return;
      }
      if (!(node instanceof Element) || SKIP.has(node.tagName) || node.classList.contains("gp-wrap-spacer")) return;
      if (layers.art) {
        const cs = getComputedStyle(node);
        if (
          ART_TAGS.has(node.localName) ||
          cs.backgroundImage !== "none" ||
          !/^rgba\(.*, 0\)$/.test(cs.backgroundColor) ||
          parseFloat(cs.borderTopWidth) > 0 ||
          parseFloat(cs.borderRightWidth) > 0 ||
          parseFloat(cs.borderBottomWidth) > 0 ||
          parseFloat(cs.borderLeftWidth) > 0
        ) {
          judge(node, "art", node.getClientRects());
        }
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(root);
  };

  for (const strip of strips) {
    const zoom = cssZoomOf(strip.el);
    // The anchor of a fragment is the middle of its in-column part, so a box
    // that overhangs its column on either side is still attributed to the page
    // it starts on (`indexInStrip` floors a coordinate to a column).
    const colW = (parseFloat(strip.el.style.getPropertyValue("--gp-content-w")) || 0) * zoom;
    const colH = (parseFloat(strip.el.style.getPropertyValue("--gp-content-h")) || 0) * zoom;
    const pageOf = (r: DOMRect) => {
      const ax = r.left + Math.min(r.width, colW || r.width) / 2;
      const ay = r.top + Math.min(r.height, colH || r.height) / 2;
      return painted.get(strip.offset + indexInStrip(ax, ay, strip));
    };
    for (const child of strip.el.childNodes) inspect(child, pageOf, zoom);
  }
  // Page furniture (folios, running heads, chips) is drawn on the sheets, not in
  // the strips, so each sheet is walked for it.
  for (const target of painted.values()) {
    for (const furniture of target.sheet.querySelectorAll(".gp-marginbox")) inspect(furniture, () => target, stage.zoom);
  }

  for (const f of flags) {
    const el = div("gp-ov-flag", f.box);
    el.dataset.kind = f.kind;
    el.dataset.rule = f.rule;
    el.title = f.title;
    f.host.appendChild(el);
  }
  const summary: OverlaySummary = {
    on: true,
    layers,
    issues: counts.text + counts.art + counts.bleed + counts.offPage,
    intended: counts.intended,
    bleedPt: area?.bleed ?? 0,
    safePt: area?.safe ?? 0,
    artSafePt: area?.artSafe ?? 0,
    counts,
  };
  root?.appendChild(legend(layers, area, summary));
  return summary;
}
