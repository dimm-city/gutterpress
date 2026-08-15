/**
 * Diagnostic for SPIKE C: which WORDS vanish between source and round-trip?
 * Runs the RUN 2 configuration and reports a multiset difference of words.
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

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/gi) ?? [];

function missing(src: string, out: string): string[] {
  const have = new Map<string, number>();
  for (const w of words(out)) have.set(w, (have.get(w) ?? 0) + 1);
  const gone: string[] = [];
  for (const w of words(src)) {
    const n = have.get(w) ?? 0;
    if (n === 0) gone.push(w);
    else have.set(w, n - 1);
  }
  return gone;
}

const { parser, ser } = makeRun2();
const tally = new Map<string, number>();
let filesWithLoss = 0;

for (const book of BOOKS) {
  const dir = join(REPO, book);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const src = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n");
    let out: string;
    try {
      out = ser.serialize(parser.parse(src));
    } catch {
      continue;
    }
    const gone = missing(src, out);
    if (!gone.length) continue;
    filesWithLoss++;
    if (filesWithLoss <= 4) {
      console.log(`\n${book}/${file}  (${gone.length} words)`);
      console.log(`   ${gone.slice(0, 28).join(" ")}`);
    }
    for (const w of gone) tally.set(w, (tally.get(w) ?? 0) + 1);
  }
}

console.log(`\n\nmost-frequently-lost words across ${filesWithLoss} files:`);
for (const [w, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`   ${String(n).padStart(4)}  ${w}`);
}
