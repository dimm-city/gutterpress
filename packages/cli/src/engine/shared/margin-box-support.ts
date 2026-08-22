/**
 * Declarations Chromium accepts syntactically in `@page` margin boxes but
 * silently drops in native print. These were measured with deliberately
 * visible values (`rotate(-12deg)`, `6px 6px 0 #c00`) and are documented in
 * docs/engine-history/ENGINE.md §8.
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
  "box-shadow",
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
