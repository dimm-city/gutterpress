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
