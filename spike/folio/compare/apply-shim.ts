/**
 * Append a CSS file (default `fg-shim.css`, now the field-guide
 * page-furniture starting point — see that file's header) to a copy of a
 * staged book.html.
 *
 * Never edits the original: writes `book.shimmed.html` next to the input with
 * the stylesheet inlined as the LAST <style> in <head>, so it wins every
 * equal-specificity cascade fight against the book's own CSS — the same
 * position Paged.js's generated styles occupy.
 *
 * The `body { zoom: 1.5 }` scale shim `fg-shim.css` used to also carry is
 * retired (2026-08-06): the field guide's over-wide layout that made scale
 * comparison necessary is fixed upstream, so an honest A/B needs no shim of
 * any kind (see COMPARISON.md's "HONEST A/B REPORT"). This script still has a
 * use — furniture-only comparisons — but is no longer part of the default A/B
 * recipe.
 *
 *   bun compare/apply-shim.ts /tmp/cmp-fg/staged/book.html [shim.css]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const input = process.argv[2] ?? "/tmp/cmp-fg/staged/book.html";
const shimPath = process.argv[3] ?? join(import.meta.dir, "fg-shim.css");

const html = readFileSync(input, "utf8");
const shim = readFileSync(shimPath, "utf8");
const tag = `\n<style data-folio-ab-shim>\n${shim}\n</style>\n`;

const out = html.includes("</head>")
  ? html.replace("</head>", `${tag}</head>`)
  : html + tag;

const outPath = join(dirname(input), "book.shimmed.html");
writeFileSync(outPath, out);
console.log(outPath);
