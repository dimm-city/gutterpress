/**
 * Apples-to-apples with lexical-modelled.ts.
 *
 * lossless.ts counts TOP-LEVEL token runs (566), but ProseMirror nests content
 * inside `marker_wrap` while Lexical flattens everything to root children
 * (1165). Comparing those percentages directly would be wrong. This walks the
 * whole PM document and counts every block node, so both arms are measured on
 * the same denominator.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeRun2 } from "./harness.ts";

const REPO = new URL("../../../", import.meta.url).pathname;
const BOOKS = [
  "examples/gutterpress-user-guide",
  "examples/gutterwire-zine",
  "examples/with-validation",
  "examples/with-design-guide/book-01",
  "examples/with-design-guide/book-02",
  "examples/with-design-guide/design-guide",
  "docs/fixtures/css-authoring-spike/book",
];

const { parser } = makeRun2();

let blocks = 0;
let opaque = 0;
const byType = new Map<string, number>();

/** Count block-level nodes; `raw_block` is the flagged, non-editable fallback. */
function walk(node: any) {
  node.forEach((child: any) => {
    if (child.isInline) return;
    blocks++;
    byType.set(child.type.name, (byType.get(child.type.name) ?? 0) + 1);
    if (child.type.name === "raw_block") opaque++;
    if (child.content.size) walk(child);
  });
}

for (const book of BOOKS) {
  const dir = join(REPO, book);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    walk(parser.parse(readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n")));
  }
}

const pct = (n: number) => `${((n / Math.max(1, blocks)) * 100).toFixed(1)}%`;
console.log(`\n── ProseMirror: what does the editor actually MODEL? ──`);
console.log(`  block nodes         : ${blocks}`);
console.log(`    modelled          : ${blocks - opaque} (${pct(blocks - opaque)})`);
console.log(`    opaque fallback   : ${opaque} (${pct(opaque)})   <- flagged, not silent`);
console.log(`  block node types produced:`);
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${t.padEnd(14)} ${n}`);
