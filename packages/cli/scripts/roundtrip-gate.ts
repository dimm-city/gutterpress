#!/usr/bin/env bun
/**
 * roundtrip-gate.ts — corpus soundness gate for the Galley codec (Galley v2,
 * docs/tiptap-galley-architecture.md).
 *
 * For EVERY markdown file of EVERY example book, tokenize with the product's
 * one markdown-it renderer, build the ProseMirror galley doc, and enforce the
 * codec's four invariants (the same ones galley.test.ts holds, ratcheted here
 * over the whole corpus as a release gate):
 *
 *   (a) ZERO LOST WORDS — canonical serialization AND byte-preserving
 *       serialization each keep every source word (word-multiset diff).
 *   (b) CANONICAL IDEMPOTENCE — serialize(reparse(serialize(doc))) equals
 *       serialize(doc): the canonical form is a fixed point.
 *   (c) OPAQUE RATE — at most 2% of all blocks degrade to opaque rawBlock
 *       atoms (verbatim but uneditable).
 *   (d) BYTE PRESERVATION — at least 80% of untouched corpus files serialize
 *       back byte-identical (modulo leading/trailing whitespace).
 *
 * Runs under plain `bun` — tokens → doc → markdown, no browser involved.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMarkdownRenderer } from "../src/lib/markdown/renderer";
import { galleySchema } from "../src/engine/galley/extensions";
import {
  buildGalleyDoc,
  serializeGalleyDoc,
  type GalleyToken,
} from "../src/engine/galley/markdown";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const BOOKS: Array<{ name: string; dir: string }> = [
  { name: "gutterpress-user-guide", dir: "examples/gutterpress-user-guide" },
  { name: "gutterwire-zine", dir: "examples/gutterwire-zine" },
  { name: "with-validation", dir: "examples/with-validation" },
  { name: "with-design-guide/book-01", dir: "examples/with-design-guide/book-01" },
  { name: "with-design-guide/book-02", dir: "examples/with-design-guide/book-02" },
  { name: "with-design-guide/design-guide", dir: "examples/with-design-guide/design-guide" },
  { name: "css-authoring-spike", dir: "docs/fixtures/css-authoring-spike/book" },
];

const OPAQUE_RATE_MAX = 0.02;
const BYTE_IDENTICAL_MIN = 0.8;

const md = createMarkdownRenderer();
const schema = galleySchema();

/** Tokens exactly as the server route ships them: through JSON. */
const tokensOf = (source: string): GalleyToken[] =>
  JSON.parse(JSON.stringify(md.parse(source, {}))) as GalleyToken[];

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/gi) ?? [];

/** Multiset difference a − b: words of `a` missing from `b`. */
function lostWords(a: string, b: string): string[] {
  const pool = new Map<string, number>();
  for (const w of words(b)) pool.set(w, (pool.get(w) ?? 0) + 1);
  const missing: string[] = [];
  for (const w of words(a)) {
    const n = pool.get(w) ?? 0;
    if (n === 0) missing.push(w);
    else pool.set(w, n - 1);
  }
  return missing;
}

interface BookStats {
  name: string;
  files: number;
  blocks: number;
  opaque: number;
  byteIdentical: number;
}

const failures: string[] = [];
const allStats: BookStats[] = [];

for (const book of BOOKS) {
  const dir = join(repoRoot, book.dir);
  const stats: BookStats = { name: book.name, files: 0, blocks: 0, opaque: 0, byteIdentical: 0 };

  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const rel = `${book.name}/${f}`;
    const source = readFileSync(join(dir, f), "utf8").replace(/\r\n?/g, "\n");
    stats.files++;

    const { doc, srcMap, stats: buildStats } = buildGalleyDoc(schema, tokensOf(source), source);
    stats.blocks += buildStats.blocks;
    stats.opaque += buildStats.opaque;

    // (a) zero lost words — canonical mode.
    const canonical = serializeGalleyDoc(schema, doc);
    const lostCanonical = lostWords(source, canonical);
    if (lostCanonical.length) {
      failures.push(
        `${rel}: canonical serialization lost ${lostCanonical.length} word(s) — ${lostCanonical.slice(0, 10).join(" ")}`,
      );
    }

    // (a) zero lost words — byte-preserving mode; (d) byte-identical count.
    const preserved = serializeGalleyDoc(schema, doc, srcMap);
    const lostPreserved = lostWords(source, preserved);
    if (lostPreserved.length) {
      failures.push(
        `${rel}: preserved serialization lost ${lostPreserved.length} word(s) — ${lostPreserved.slice(0, 10).join(" ")}`,
      );
    }
    if (preserved.trim() === source.trim()) stats.byteIdentical++;

    // (b) canonical idempotence: serialize of the reparse equals the first
    // serialize.
    const { doc: doc2 } = buildGalleyDoc(schema, tokensOf(canonical), canonical);
    const twice = serializeGalleyDoc(schema, doc2);
    if (twice !== canonical) {
      const i = [...canonical].findIndex((c, idx) => twice[idx] !== c);
      failures.push(
        `${rel}: canonical serialization is not idempotent — diverges at ${i}: ` +
          `${JSON.stringify(canonical.slice(i, i + 60))} vs ${JSON.stringify(twice.slice(i, i + 60))}`,
      );
    }
  }

  allStats.push(stats);
}

// ── report ──────────────────────────────────────────────────────────────────

const totals = allStats.reduce(
  (t, s) => ({
    files: t.files + s.files,
    blocks: t.blocks + s.blocks,
    opaque: t.opaque + s.opaque,
    byteIdentical: t.byteIdentical + s.byteIdentical,
  }),
  { files: 0, blocks: 0, opaque: 0, byteIdentical: 0 },
);

const opaquePct = (s: { blocks: number; opaque: number }) =>
  s.blocks ? (100 * s.opaque) / s.blocks : 0;

console.log("\ngalley round-trip corpus gate — tokens → PM doc → markdown\n");
console.log("book                                     files  blocks  opaque  opaque%  byte-id");
for (const s of allStats) {
  console.log(
    `${s.name.padEnd(40)}${String(s.files).padStart(6)}${String(s.blocks).padStart(8)}` +
      `${String(s.opaque).padStart(8)}${opaquePct(s).toFixed(1).padStart(8)}%` +
      `${`${s.byteIdentical}/${s.files}`.padStart(9)}`,
  );
}
console.log(
  `${"TOTAL".padEnd(40)}${String(totals.files).padStart(6)}${String(totals.blocks).padStart(8)}` +
    `${String(totals.opaque).padStart(8)}${opaquePct(totals).toFixed(1).padStart(8)}%` +
    `${`${totals.byteIdentical}/${totals.files}`.padStart(9)}`,
);

let failed = false;

if (failures.length) {
  failed = true;
  console.error(`\n✖ ${failures.length} zero-loss/idempotence failure(s):\n`);
  for (const f of failures.slice(0, 20)) console.error(`— ${f}`);
  if (failures.length > 20) console.error(`… and ${failures.length - 20} more`);
}

if (totals.blocks && totals.opaque / totals.blocks > OPAQUE_RATE_MAX) {
  failed = true;
  console.error(
    `\n✖ opaque rate ${opaquePct(totals).toFixed(2)}% exceeds the ${(OPAQUE_RATE_MAX * 100).toFixed(0)}% ceiling ` +
      `(${totals.opaque}/${totals.blocks} blocks)`,
  );
}

if (totals.byteIdentical < Math.floor(totals.files * BYTE_IDENTICAL_MIN)) {
  failed = true;
  console.error(
    `\n✖ only ${totals.byteIdentical}/${totals.files} untouched files serialize byte-identical ` +
      `(floor is ${(BYTE_IDENTICAL_MIN * 100).toFixed(0)}%)`,
  );
}

if (failed) process.exit(1);
console.log("\n✓ galley corpus round-trip gate green");
