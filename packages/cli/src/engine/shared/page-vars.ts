/**
 * The page's own numbers, published as custom properties so a stylesheet reads
 * them instead of keeping a copy that stops following Book setup:
 *
 *   --gp-page-width  --gp-page-height  --gp-page-bleed  --gp-page-safe
 *   --gp-page-gutter  --gp-page-art-safe  --gp-page-margin-top
 *   --gp-page-margin-bottom  --gp-page-margin-inside  --gp-page-margin-outside
 *
 * Every value is in `pt` with the unit, so `calc()` takes it directly, and every
 * name is always there: a value the book does not define is `0pt`.
 *
 * Where each comes from:
 *  - size and margins: the `@page` reader (`resolvePage`) over the stylesheet
 *    the engine reads. The assembly writes the manifest's size, and its margins
 *    when it sets any, as plain `@page` rules after every sheet (see
 *    lib/markdown/assemble.ts), so the reader returns the manifest's when it
 *    decided and the look's or the 1in default when it did not. The recto is
 *    read (`:right`, page 1 and every odd page): `inside` is its left, the
 *    binding, and `outside` its right.
 *  - bleed, safe, gutter, art-safe: the manifest's `page`, through the book's
 *    `<meta name="gp-print-area">` (shared/print-area.ts).
 *
 * The size and margins are also published per named page, on the selectors that
 * assign it (the way `--gp-content-h` is); the book-wide ones are on `:root`.
 *
 * Pure: the compiler publishes this CSS for the PDF and the viewer for the
 * preview (viewer/fragment.ts), from the same model and print area.
 */
import { resolvePage, type GcpmModel } from "./gcpm-extract.ts";
import { round3, type PrintArea } from "./print-area.ts";

/** `--gp-page-<name>: <n>pt;` for each pair, on one line. */
const decls = (pairs: Array<[string, number]>) =>
  pairs.map(([name, n]) => `--gp-page-${name}: ${round3(n)}pt;`).join(" ");

/** The declarations for what a named page can change: its sheet and its margins. */
function pageDecls(model: GcpmModel, name?: string): string {
  const { width, height, margin } = resolvePage(model, { name, pseudos: ["right"] }).geometry;
  return decls([
    ["width", width],
    ["height", height],
    ["margin-top", margin.top],
    ["margin-bottom", margin.bottom],
    ["margin-inside", margin.left],
    ["margin-outside", margin.right],
  ]);
}

/** The `gp-page-vars` rules for one book; `area` is `null` when it carries no print area. */
export function pageGeometryVarsCss(model: GcpmModel, area: PrintArea | null): string {
  const bookWide = decls([
    ["bleed", area?.bleed ?? 0],
    ["safe", area?.safe ?? 0],
    ["gutter", area?.gutter ?? 0],
    ["art-safe", area?.artSafe ?? 0],
  ]);
  return [
    `:root { ${pageDecls(model)} ${bookWide} }`,
    ...model.pageAssignments.map((a) => `${a.selector} { ${pageDecls(model, a.page)} }`),
  ].join("\n");
}
