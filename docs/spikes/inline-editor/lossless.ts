/**
 * SPIKE C — does a ProseMirror schema + an AUTOMATIC opaque-node fallback
 * round-trip the real Gutterpress corpus with ZERO content loss?
 *
 * The mechanism under test is not "write a handler for every token". It is:
 *
 *   wrap the tokenizer -> for every top-level token run whose types (or whose
 *   inline children's types) have no schema handler, splice the run out and
 *   replace it with ONE synthetic token carrying the verbatim source slice
 *   from `token.map`. That becomes an atom node that serializes back byte-for-
 *   byte.
 *
 * If that holds, "Tiptap drops content it doesn't understand" stops being a
 * property of the library and becomes a property of the integration: unknown
 * constructs degrade to a non-editable-but-intact block instead of vanishing.
 *
 * Two runs quantify the trade:
 *   RUN 1  stock CommonMark schema  -> baseline: how much of the corpus falls
 *                                      back when you add nothing
 *   RUN 2  + Gutterpress node types -> how much stays richly editable for a
 *                                      day of schema work
 * The delta between them IS the schema work list.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "prosemirror-model";
import {
  makeParser,
  serializerFor,
  stockSchema,
  gpSchema,
  commonTokens,
  gpTokens,
  emptyStats,
  type Stats,
} from "./harness.ts";

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

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/gi) ?? [];

/**
 * Multiset difference `a - b`. Content loss is asymmetric: words present in
 * the source and absent from the round-trip are a defect; words the serializer
 * ADDS (canonical `@end` terminators) are a formatting normalization. A
 * character-count delta conflates the two, so measure each direction.
 */
function minus(a: string, b: string): string[] {
  const pool = new Map<string, number>();
  for (const w of words(b)) pool.set(w, (pool.get(w) ?? 0) + 1);
  const diff: string[] = [];
  for (const w of words(a)) {
    const n = pool.get(w) ?? 0;
    if (n === 0) diff.push(w);
    else pool.set(w, n - 1);
  }
  return diff;
}

interface RunResult {
  label: string;
  files: number;
  parsed: number;
  contentPreserved: number;
  byteIdentical: number;
  wordsLost: number;
  wordsAdded: number;
  stats: Stats;
  failures: string[];
}

function run(label: string, schema: Schema, tokens: Record<string, any>): RunResult {
  const stats: Stats = emptyStats();
  const parser = makeParser(schema, tokens, stats);
  const ser = serializerFor(tokens);
  const res: RunResult = {
    label,
    files: 0,
    parsed: 0,
    contentPreserved: 0,
    byteIdentical: 0,
    wordsLost: 0,
    wordsAdded: 0,
    stats,
    failures: [],
  };

  for (const book of BOOKS) {
    const dir = join(REPO, book);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      res.files++;
      const src = readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n");
      let doc: any;
      try {
        doc = parser.parse(src);
      } catch (e) {
        res.failures.push(`${book}/${file}: parse — ${String(e).slice(0, 88)}`);
        continue;
      }
      let out: string;
      try {
        out = ser.serialize(doc);
      } catch (e) {
        res.failures.push(`${book}/${file}: serialize — ${String(e).slice(0, 88)}`);
        continue;
      }
      res.parsed++;
      if (out.trim() === src.trim()) res.byteIdentical++;
      const lost = minus(src, out);
      res.wordsAdded += minus(out, src).length;
      if (lost.length === 0) res.contentPreserved++;
      else {
        res.wordsLost += lost.length;
        res.failures.push(`${book}/${file}: LOST ${lost.length} words — ${lost.slice(0, 8).join(" ")}`);
      }
    }
  }
  return res;
}

function report(r: RunResult) {
  const { stats } = r;
  const editable = stats.topLevel - stats.opaque - stats.unmappable;
  const pct = (n: number) => `${((n / Math.max(1, stats.topLevel)) * 100).toFixed(1)}%`;
  console.log(`\n── ${r.label} ${"─".repeat(Math.max(0, 58 - r.label.length))}`);
  console.log(`  parsed + serialized : ${r.parsed}/${r.files} files`);
  console.log(`  CONTENT preserved   : ${r.contentPreserved}/${r.files} files, ${r.wordsLost} words lost   <- the content-loss metric`);
  console.log(`  byte-identical      : ${r.byteIdentical}/${r.files} files, ${r.wordsAdded} words added   <- formatting fidelity (storage-level)`);
  console.log(`  top-level blocks    : ${stats.topLevel}`);
  console.log(`    richly editable   : ${editable} (${pct(editable)})`);
  console.log(`    opaque fallback   : ${stats.opaque} (${pct(stats.opaque)})`);
  if (stats.unmappable) console.log(`    UNMAPPABLE (lost!) : ${stats.unmappable}`);
  const causes = [...stats.causes.entries()].sort((a, b) => b[1] - a[1]);
  if (causes.length) {
    console.log(`  what forced fallback (token type x occurrences):`);
    for (const [t, n] of causes) console.log(`    ${t.padEnd(26)} ${n}`);
  }
  if (r.failures.length) {
    console.log(`  failures (${r.failures.length}):`);
    for (const f of r.failures.slice(0, 8)) console.log(`    ${f}`);
  }
}

report(run("RUN 1 — stock CommonMark schema + auto-escalation", stockSchema, commonTokens));
report(run("RUN 2 — + Gutterpress node types", gpSchema, gpTokens));
