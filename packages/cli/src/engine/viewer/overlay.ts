/**
 * Safe area & bleed overlay (viewer chrome — PERMANENT tooling, not a shim).
 *
 * An author-facing review aid: while it is on, every page in the preview shows
 * its safe area (dashed, with the band between it and the trim tinted), the
 * trim, and the bleed band (translucent), and any element whose box leaves the
 * safe area is outlined — amber when it stays on the trimmed page, red when it
 * crosses the trim into the bleed or off the sheet. Art the author placed on
 * purpose (`.gp-bleed`, `.gp-pin`, `.gp-flush`, `.gp-behind`) is outlined
 * softly in violet and not counted.
 *
 * WHERE THE GEOMETRY COMES FROM: the project's manifest and its preset, and
 * nothing else — `page.width` x `page.height` (the sheet), `page.bleed` (a bleed
 * the sheet already contains on the top, bottom and OUTER edge; the binding
 * edge has none, as DriveThruRPG cuts it) and `page.safe` (the safe area's
 * inset from the trim on every edge). Preview assembly hands them in as
 * `<meta name="gp-print-area">`. No book or plugin CSS feeds it: not the
 * `@page` margins (they are where the author put the TEXT, which is not the
 * printer's safe area), not `@page { bleed }`. Each box is anchored on the top-
 * left of the sheet the viewer drew for that page, so it sits on the paper
 * wherever the paper is.
 *
 * WHERE IT IS DRAWN: one `<gp-overlay>` element on `<html>`, outside `<body>`
 * (the stage the book's CSS styles), with every property that could place,
 * hide or restyle it set inline and `!important`, and all of its content in a
 * shadow root with its own stylesheet and its own tokens. No selector in a
 * book or plugin stylesheet reaches inside, no custom property they set is
 * inherited by it, and it stacks above the whole book. It mirrors the stage's
 * zoom (a paint transform) and is re-synced when a host changes it.
 *
 * How it looks is set in ONE place — the tokens in `OVERLAY_CSS` below. The app
 * lets a user change the colour and a three-step strength (`OverlayStyle`);
 * both only set a token on the overlay's own root, so nothing repaints.
 *
 * What it never does: it adds no box to author content and no class or
 * attribute to author elements, so pagination is untouched (a test measures
 * page counts with the overlay off and on). It only exists while the overlay is
 * on, is hidden for `@media print`, and is never part of a built PDF.
 *
 * Removal: delete this file and the `setOverlay` hook in decorate.ts. Nothing
 * else depends on it.
 */
import { PX_PER_PT, cssZoomOf, indexInStrip, type StripInfo } from "./fragment.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The project's page geometry, in pt — the manifest's `page` block. */
export interface PrintArea {
  width: number;
  height: number;
  /** in-sheet bleed on the top, bottom and outer edge; 0 = none */
  bleed: number;
  /** safe-area inset from the trim on every edge; 0 = none */
  safe: number;
}

export type PageSide = "recto" | "verso";

/** The nested boxes of one page, in one unit, origin at the sheet's top-left. */
export interface PageBoxes {
  /** the whole sheet (the bleed box when the sheet contains a bleed) */
  sheet: Rect;
  /** the cut page */
  trim: Rect;
  /** where content is safe from the cut: the trim inset by `safe` */
  safe: Rect;
  bleed: number;
}

/**
 * Boxes for one page. The trim is the sheet pulled in by `bleed` on the top,
 * bottom and OUTER edge — the right edge of a recto, the left edge of a verso;
 * the binding edge has no bleed. The safe area is the trim pulled in by `safe`
 * on every edge.
 */
export function pageBoxes(area: PrintArea, side: PageSide, scale = 1): PageBoxes {
  const w = area.width * scale;
  const h = area.height * scale;
  const b = Math.max(0, area.bleed) * scale;
  const s = Math.max(0, area.safe) * scale;
  const trim = { x: side === "verso" ? b : 0, y: b, w: Math.max(0, w - b), h: Math.max(0, h - 2 * b) };
  return {
    sheet: { x: 0, y: 0, w, h },
    trim,
    safe: { x: trim.x + s, y: trim.y + s, w: Math.max(0, trim.w - 2 * s), h: Math.max(0, trim.h - 2 * s) },
    bleed: b,
  };
}

/**
 * Where an element's box sits relative to its page, worst first:
 *  - `inside`   within the safe area
 *  - `unsafe`   leaves the safe area but stays on the trimmed page
 *  - `bleed`    crosses the trim but stays on the sheet (in the bleed band)
 *  - `off-page` crosses the sheet's edge: that part is not printed at all
 */
export type OverflowKind = "inside" | "unsafe" | "bleed" | "off-page";

const SEVERITY: Record<OverflowKind, number> = { inside: 0, unsafe: 1, bleed: 2, "off-page": 3 };

const within = (r: Rect, outer: Rect, tol: number) =>
  r.x >= outer.x - tol &&
  r.y >= outer.y - tol &&
  r.x + r.w <= outer.x + outer.w + tol &&
  r.y + r.h <= outer.y + outer.h + tol;

/** `tol` absorbs sub-pixel layout (LayoutUnit is 1/64 px) so an exact fit is not flagged. */
export function classifyRect(r: Rect, boxes: PageBoxes, tol = 0): OverflowKind {
  if (within(r, boxes.safe, tol)) return "inside";
  if (within(r, boxes.trim, tol)) return "unsafe";
  if (boxes.bleed > 0 && within(r, boxes.sheet, tol)) return "bleed";
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
 * Art the author placed on purpose — it is EXPECTED to leave the safe area,
 * so it is shown softly and never counted as a problem. Core's own vocabulary
 * (gutterpress-css.ts / markers.js): `.gp-bleed` (edge-to-edge plate),
 * `.gp-pin` (+ `.gp-flush`, pinned to the paper edge), `.gp-behind` (art
 * behind the text) and the `@page full-bleed` page.
 */
export const INTENT_SELECTOR = ".gp-bleed, .gp-pin, .gp-flush, .gp-behind, .gp-page-full-bleed";

/**
 * The two knobs a host may turn. They carry no geometry: the overlay maps them
 * onto its own tokens, so "more or less prominent" and "which colour" are the
 * whole vocabulary.
 */
export const OVERLAY_STRENGTHS = ["subtle", "normal", "strong"] as const;
export type OverlayStrength = (typeof OVERLAY_STRENGTHS)[number];
export interface OverlayStyle {
  /** safe-area outline + tint colour, `#rgb` / `#rrggbb` */
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
  /** elements that leave the safe area by accident (counted) */
  issues: number;
  /** intentional art that leaves it on purpose (shown, not counted) */
  intended: number;
  /** the project's in-sheet bleed in pt (0 = none set) */
  bleedPt: number;
  /** the project's safe-area inset in pt (0 = none set) */
  safePt: number;
}

export const OVERLAY_OFF: OverlaySummary = { on: false, issues: 0, intended: 0, bleedPt: 0, safePt: 0 };

/** One drawn page, as `decorate()` knows it. */
export interface OverlayPage {
  /** 0-based, book-wide */
  index: number;
  sheet: HTMLElement;
  strip: StripInfo;
}

/**
 * The project's page geometry from the preview page's own
 * `<meta name="gp-print-area">` — present only in the live preview's
 * book.html, never in a built or published document. `null` without it.
 */
export function printAreaFromMeta(): PrintArea | null {
  const raw = document.querySelector('meta[name="gp-print-area"]')?.getAttribute("content");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PrintArea>;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
    if (!n(v.width) || !n(v.height)) return null;
    return { width: n(v.width), height: n(v.height), bleed: n(v.bleed), safe: n(v.safe) };
  } catch {
    return null;
  }
}

/**
 * Without the project's geometry (a page the preview server did not build), a
 * sheet's own size stands in and there is no bleed or safe area to draw.
 */
function sheetArea(sheet: HTMLElement): PrintArea {
  const px = (name: string) => parseFloat(sheet.style.getPropertyValue(name)) || 0;
  return { width: px("--gp-page-w") / PX_PER_PT, height: px("--gp-page-h") / PX_PER_PT, bleed: 0, safe: 0 };
}

/**
 * The overlay's whole look. Lives in the shadow root, so it is the only CSS
 * that applies there, and its tokens are declared on `.root` itself, so a
 * value a book sets on `:root` or `body` can never be inherited in.
 */
export const OVERLAY_CSS = `
.root {
  --gp-ov-color: #2f80ed;       /* safe-area line + the tint outside it */
  --gp-ov-width: 2px;           /* line width as seen on screen, at any zoom */
  --gp-ov-style: dashed;        /* safe-area line style */
  --gp-ov-tint: 0.1;            /* opacity of the tint between safe area and trim */
  --gp-ov-bleed-color: #e5484d; /* bleed band */
  --gp-ov-bleed-alpha: 0.45;    /* opacity of the bleed band */
  --gp-ov-trim-color: #8a0b18;  /* the trim line: darker than the band so it reads as an edge */
  --gp-ov-flag-width: 2px;      /* overflow flag outline */
  --gp-ov-warn: #f59e0b;        /* leaves the safe area */
  --gp-ov-error: #e5484d;       /* crosses the trim / leaves the sheet */
  --gp-ov-intent: #8b5cf6;      /* placed on purpose */
  /* The overlay is scaled with the stage, so a 2px line would shrink with the
     zoom; dividing by it keeps lines the same width on screen at every zoom. */
  --gp-ov-w: calc(var(--gp-ov-width) / var(--gp-ov-z, 1));
  --gp-ov-flag-w: calc(var(--gp-ov-flag-width) / var(--gp-ov-z, 1));
  position: absolute;
  inset: 0;
  pointer-events: none;
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
.gp-ov-page, .gp-ov-tint, .gp-ov-safe, .gp-ov-bleed, .gp-ov-trim, .gp-ov-flag {
  position: absolute;
  box-sizing: border-box;
}
/* the band between the safe area and the trim, as a REGION (clip-path, set in
   overlay.ts), so it reads as an area, not a hairline */
.gp-ov-tint {
  background: color-mix(in srgb, var(--gp-ov-color) calc(var(--gp-ov-tint) * 100%), transparent);
}
.gp-ov-safe {
  border: var(--gp-ov-w) var(--gp-ov-style) var(--gp-ov-color);
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
  "transform-origin: 0 0",
  "contain: style",
]
  .map((d) => `${d} !important`)
  .join("; ");

export const OVERLAY_TAG = "gp-overlay";

let host: HTMLElement | null = null;
let root: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let currentStyle: OverlayStyle = {};
/** each drawn page box with the sheet it sits on, re-anchored by `syncToStage` */
let anchored: Array<{ box: HTMLElement; sheet: HTMLElement }> = [];

function applyStyle(): void {
  if (!root) return;
  if (currentStyle.strength) root.dataset.strength = currentStyle.strength;
  if (currentStyle.color) root.style.setProperty("--gp-ov-color", currentStyle.color);
}

/** Remember the look and apply it to a showing overlay; no repaint. */
export function setOverlayStyle(style: OverlayStyle): void {
  currentStyle = { ...currentStyle, ...style };
  applyStyle();
}

/** The stage's (`<body>`) zoom and on-screen origin. */
function stageFrame(): { left: number; top: number; zoom: number } {
  const stage = document.body;
  const r = stage.getBoundingClientRect();
  const zoom = stage.offsetWidth > 0 ? r.width / stage.offsetWidth : 1;
  return { left: r.left, top: r.top, zoom: zoom || 1 };
}

/**
 * Line the overlay up with the stage: same origin, same zoom, and each page
 * box on its sheet. The sheets' runs are centered in the stage, so a zoom
 * change or a window resize moves them sideways; the boxes follow by reading
 * their sheets again, which is cheaper than a repaint.
 */
function syncToStage(): void {
  if (!host || !root) return;
  const stage = stageFrame();
  host.style.setProperty(
    "transform",
    `translate(${stage.left + window.scrollX}px, ${stage.top + window.scrollY}px) scale(${stage.zoom})`,
    "important",
  );
  root.style.setProperty("--gp-ov-z", String(stage.zoom));
  for (const { box, sheet } of anchored) {
    const r = sheet.getBoundingClientRect();
    box.style.left = `${(r.left - stage.left) / stage.zoom}px`;
    box.style.top = `${(r.top - stage.top) / stage.zoom}px`;
  }
}

function ensureRoot(): HTMLElement {
  if (host && root && host.isConnected) {
    root.textContent = "";
    return root;
  }
  host = document.createElement(OVERLAY_TAG);
  host.setAttribute("style", HOST_STYLE);
  host.setAttribute("aria-hidden", "true");
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
  // the overlay's transform in step with it.
  observer = new MutationObserver(syncToStage);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
  window.addEventListener("resize", syncToStage);
  return root;
}

export function clearOverlay(): void {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("resize", syncToStage);
  anchored = [];
  host?.remove();
  host = null;
  root = null;
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

/** The band between the safe area and the trim, as a region (even-odd, so exact at any zoom). */
function unsafeTint(b: PageBoxes): HTMLDivElement {
  const el = div("gp-ov-tint", b.sheet);
  const t = b.trim;
  const s = b.safe;
  el.style.clipPath =
    `polygon(evenodd, ${t.x}px ${t.y}px, ${t.x + t.w}px ${t.y}px, ${t.x + t.w}px ${t.y + t.h}px, ${t.x}px ${t.y + t.h}px, ${t.x}px ${t.y}px, ` +
    `${s.x}px ${s.y}px, ${s.x}px ${s.y + s.h}px, ${s.x + s.w}px ${s.y + s.h}px, ${s.x + s.w}px ${s.y}px, ${s.x}px ${s.y}px)`;
  return el;
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
  box: Rect;
}

/** Sub-pixel tolerance, in CSS px (unscaled). */
const TOL_PX = 1;
const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "BR", "WBR", "SOURCE", "TRACK", "META"]);

/**
 * Draw the overlay for `pages` and return what it found. Idempotent: the
 * previous drawing is replaced. `area` is the project's geometry
 * (`printAreaFromMeta()`); `null` falls back to each sheet's own size.
 */
export function paintOverlay(
  pages: readonly OverlayPage[],
  strips: readonly StripInfo[],
  area: PrintArea | null,
): OverlaySummary {
  const layer = ensureRoot();
  anchored = [];
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
    anchored.push({ box: host, sheet: p.sheet });
    if (boxes.bleed > 0) {
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
    if (area && area.safe > 0) {
      host.appendChild(unsafeTint(boxes));
      host.appendChild(div("gp-ov-safe", boxes.safe));
    }
    layer.appendChild(host);
    painted.set(p.index, { host, boxes, sheet: p.sheet, rect });
  }

  const flags: Flag[] = [];
  let issues = 0;
  let intended = 0;
  for (const strip of strips) {
    // A mirrored book's single-page view lays the run out twice (fragment.ts
    // `StripInfo.twin`): the real strip shows the right-hand pages, the twin
    // the left-hand ones. Each is read for the pages it shows, where its
    // text really is on the sheet.
    const roots: Array<[Element, PageSide | null]> = strip.twin
      ? [
          [strip.el, "recto"],
          [strip.twin, "verso"],
        ]
      : [[strip.el, null]];
    for (const [root, only] of roots) visitRoot(strip, root, only);
  }

  function visitRoot(strip: StripInfo, root: Element, only: PageSide | null): void {
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
        if (only && target.sheet.dataset.side !== only) continue;
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
    for (const child of Array.from(root.children)) visit(child);
  }

  for (const f of flags) {
    const el = div("gp-ov-flag", f.box);
    el.dataset.kind = f.kind;
    f.host.appendChild(el);
  }
  return { on: true, issues, intended, bleedPt: area?.bleed ?? 0, safePt: area?.safe ?? 0 };
}
