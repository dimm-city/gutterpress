#!/usr/bin/env bun
/**
 * style-diff.mjs — compare COMPUTED STYLES between two built book.html files.
 *
 * WHY THIS EXISTS
 *   The PDF harness (dc-op-manual/tools/book-diff.sh) is the correct final
 *   gate, but it costs 45-90 minutes per book. Most CSS-refactor questions
 *   ("did this rule change anything?", "which element did I break?") are
 *   answerable in ~2 minutes from computed styles instead, because the print
 *   fragmenter's input IS the computed style tree.
 *
 *   Written after a session spent bisecting a 118-page reflow with full PDF
 *   builds — 80 minutes for an answer this tool gives in three, and the
 *   builds' first pass was invalid anyway (mismatched pdftotext flags). The
 *   culprit turned out to be a zero-specificity interaction with core's
 *   `:where(.section) > :where(:first-child) { break-before: avoid }`, which
 *   three careful static reviews had all missed. Computed styles are the
 *   ground truth for that whole class of bug.
 *
 * USAGE
 *   cd packages/cli
 *   bun tools/style-diff.mjs <a/book.html> <b/book.html> [--props p1,p2] [--all]
 *
 *   Build the two sides first (fast — no PDF):
 *     bun packages/cli/src/cli.ts build <bookdir> --format html --out <out> \
 *       --skip-pre-validate --skip-lint
 *
 * OUTPUT
 *   Element counts, the number of differing elements, and per-element property
 *   deltas (first 20 by default, all with --all). Exit 1 if anything differs,
 *   so it works as a gate in a script.
 *
 * WHAT IT CANNOT SEE — run the PDF harness for these:
 *   `string-set` / `content: string()` values, @page margin-box content and
 *   chrome, actual page breaks and page counts, anything about pagination.
 *   It compares the INPUT to fragmentation, not the fragmentation.
 */
import puppeteer from "puppeteer-core";
import { resolveChromiumExecutable } from "../src/lib/chromium.ts";

const DEFAULT_PROPS = [
  "break-before", "break-after", "break-inside", "column-fill", "column-span",
  "display", "position", "float", "width", "max-width", "height", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font-size", "font-family", "font-weight", "line-height", "letter-spacing",
  "color", "background-color", "background-image",
  "border-top-width", "border-bottom-width", "border-left-width", "border-right-width",
  "overflow-x", "overflow-y", "z-index", "isolation", "opacity", "transform",
  "overflow-wrap", "object-fit", "shape-outside", "align-self", "justify-self",
];

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const showAll = args.includes("--all");
const propsArg = args.find((a) => a.startsWith("--props"));
const PROPS = propsArg ? propsArg.split("=")[1].split(",") : DEFAULT_PROPS;

if (files.length !== 2) {
  console.error("usage: bun tools/style-diff.mjs <a/book.html> <b/book.html> [--props a,b] [--all]");
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: await resolveChromiumExecutable(),
  headless: true,
  args: ["--no-sandbox"],
});

async function dump(file) {
  const page = await browser.newPage();
  // print media: the refactors this tool guards are print-only, and @media
  // print rules would otherwise be invisible here.
  await page.emulateMediaType("print");
  await page.goto("file://" + file, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const rows = await page.evaluate((props) => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      const cls = typeof el.className === "string" ? el.className : "";
      out.push(el.tagName + "." + cls + "|" + props.map((p) => cs.getPropertyValue(p)).join(";"));
    }
    return out;
  }, PROPS);
  await page.close();
  return rows;
}

const [a, b] = [await dump(files[0]), await dump(files[1])];
await browser.close();

if (a.length !== b.length) {
  console.log(`ELEMENT COUNT DIFFERS: ${a.length} vs ${b.length} — the DOM changed, not just styles.`);
  console.log("(Expected when markdown or a plugin macro changed; compare rendered text instead.)");
}

let n = 0;
const shown = [];
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  if (a[i] === b[i]) continue;
  n++;
  if (shown.length < (showAll ? Infinity : 20)) {
    const [tagA, valsA] = a[i].split("|");
    const valsB = b[i].split("|")[1];
    const A = valsA.split(";");
    const B = valsB.split(";");
    const deltas = PROPS.map((p, j) => (A[j] !== B[j] ? `${p}: ${A[j]} -> ${B[j]}` : null)).filter(Boolean);
    shown.push(`#${i} ${tagA.slice(0, 70)}\n      ${deltas.join("\n      ")}`);
  }
}

console.log(`elements: ${a.length} / ${b.length}   properties: ${PROPS.length}   differing elements: ${n}`);
for (const s of shown) console.log("  " + s);
if (n > shown.length) console.log(`  … ${n - shown.length} more (pass --all)`);
process.exit(n === 0 && a.length === b.length ? 0 : 1);
