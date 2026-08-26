/**
 * Declarations Chromium accepts syntactically in `@page` margin boxes but
 * silently drops in native print. These were measured with deliberately
 * visible values (`rotate(-12deg)`, `6px 6px 0 #c00`) and are documented in
 * docs/engine/ENGINE.md §8 and docs/known-limitations.md §2.
 *
 * The line is what the property PAINTS, not the property family: everything
 * that establishes a stacking context or paints outside the border box is
 * dropped, everything that paints inside it is honoured. `text-shadow` beside
 * `box-shadow` is the clearest pair. Re-measured on Chrome 151.0.7922.75,
 * 96dpi raster, mean absolute pixel difference against the same box without
 * the declaration (control: removing the box entirely, 2.6485):
 *
 *   dropped, all 0.0000   box-shadow · transform (rotate/scale/translate) ·
 *                         rotate/scale/translate · opacity · outline (and its
 *                         longhands) · filter · mix-blend-mode ·
 *                         backdrop-filter · clip-path · perspective
 *   honoured              text-shadow 0.1375 · border-radius 0.3397 ·
 *                         background gradient 11.2260 · writing-mode 0.3200 ·
 *                         padding-left 0.2927 · font-size 0.7864 ·
 *                         color 0.1063 · letter-spacing 0.2781 ·
 *                         text-transform 0.1804 · visibility 2.6485
 *
 * Keep the viewer and print-safety linter on this one contract: preview must
 * omit the same effects native PDF omits, while every other declaration is
 * handed to Chromium normally instead of guessing at a narrower allowlist.
 */
export const MARGIN_BOX_IGNORED_PROPERTIES: ReadonlySet<string> = new Set([
  "transform",
  "rotate",
  "translate",
  "scale",
  "perspective",
  "box-shadow",
  "opacity",
  "outline",
  "outline-color",
  "outline-style",
  "outline-width",
  "outline-offset",
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "clip-path",
]);

export function isIgnoredMarginBoxProperty(property: string): boolean {
  return MARGIN_BOX_IGNORED_PROPERTIES.has(property.toLowerCase());
}

/**
 * Geometry of each of the 16 margin boxes, per CSS Paged Media §5.3, in pt
 * SHEET coordinates (origin at the sheet's top-left). One implementation for
 * both furniture painters: the viewer's `drawMarginBoxes` overlays and the
 * compiler's `.gp-flush` furniture relocation must place a box at the same
 * spot or preview and print disagree about where the folio sits.
 */
export function marginBoxRectPt(
  name: string,
  g: { width: number; height: number; margin: { top: number; right: number; bottom: number; left: number } },
): { x: number; y: number; w: number; h: number } {
  const { top, right, bottom, left } = g.margin;
  const cw = g.width - left - right;
  const ch = g.height - top - bottom;
  const third = (n: number) => n / 3;
  const T: Record<string, [number, number, number, number]> = {
    "top-left-corner": [0, 0, left, top],
    "top-left": [left, 0, third(cw), top],
    "top-center": [left + third(cw), 0, third(cw), top],
    "top-right": [left + 2 * third(cw), 0, third(cw), top],
    "top-right-corner": [g.width - right, 0, right, top],
    "bottom-left-corner": [0, g.height - bottom, left, bottom],
    "bottom-left": [left, g.height - bottom, third(cw), bottom],
    "bottom-center": [left + third(cw), g.height - bottom, third(cw), bottom],
    "bottom-right": [left + 2 * third(cw), g.height - bottom, third(cw), bottom],
    "bottom-right-corner": [g.width - right, g.height - bottom, right, bottom],
    "left-top": [0, top, left, third(ch)],
    "left-middle": [0, top + third(ch), left, third(ch)],
    "left-bottom": [0, top + 2 * third(ch), left, third(ch)],
    "right-top": [g.width - right, top, right, third(ch)],
    "right-middle": [g.width - right, top + third(ch), right, third(ch)],
    "right-bottom": [g.width - right, top + 2 * third(ch), right, third(ch)],
  };
  const [x, y, w, h] = T[name] ?? [0, 0, 0, 0];
  return { x, y, w, h };
}

/** Horizontal alignment of a margin box's content within its slot. */
export function marginBoxAlign(name: string): "start" | "center" | "end" {
  if (name.includes("center") || name.includes("middle")) return "center";
  return /right/.test(name) ? "end" : "start";
}
