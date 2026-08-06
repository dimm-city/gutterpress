/**
 * Produce a shimmed copy of a staged book.html for A/B testing.
 *
 * Never edits the original: writes `book.shimmed.html` next to the input with
 * the shim stylesheet inlined as the LAST <style> in <head>, so it wins every
 * equal-specificity cascade fight against the book's own CSS — the same
 * position Paged.js's generated styles occupy.
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
