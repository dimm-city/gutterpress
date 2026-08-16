#!/usr/bin/env bun
/**
 * Inline-offset coverage report.
 *
 * `inline-offsets.ts` refuses to emit a coordinate it cannot prove, so the
 * question that decides whether seamless typing is viable is not "does it
 * work" but "how much of a real book does it cover". This measures that
 * against the example books, using the PRODUCTION renderer (typographer and
 * linkify on — typographer substitutions are deliberately unmappable, so the
 * number here is the honest one, not a flattering one).
 *
 * Reported per book:
 *   blocks        blocks carrying inline text
 *   mapped        blocks with at least one coordinate
 *   full          blocks where EVERY rendered character maps
 *   chars         rendered characters mapped / total
 *
 * A block that is not fully mapped is not unusable — a caret inside a mapped
 * run still commits; only offsets in the gaps degrade to editing that block's
 * source. `full` is therefore a floor on the typing experience, `chars` the
 * realistic measure.
 *
 * Usage: bun scripts/inline-offset-coverage.ts [book-dir ...]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createMarkdownRenderer } from "../src/lib/markdown/renderer.ts";
import {
  SOURCE_OFFSETS_ATTR,
  decodeSegments,
  mappedLength,
  renderedTextOf,
} from "../src/lib/markdown/inline-offsets.ts";

const REPO = resolve(import.meta.dir, "..", "..", "..");

const DEFAULT_BOOKS = [
  join(REPO, "examples", "gutterpress-user-guide"),
  join(REPO, "examples", "with-design-guide", "design-guide"),
  join(REPO, "examples", "with-design-guide", "book-01"),
  join(REPO, "examples", "with-design-guide", "book-02"),
  join(REPO, "examples", "gutterwire-zine"),
  join(REPO, "examples", "with-validation"),
  join(REPO, "docs", "fixtures", "css-authoring-spike", "book"),
  join(REPO, "docs", "fixtures", "gp-image-positioning", "book"),
];

interface Tally {
  blocks: number;
  mapped: number;
  full: number;
  renderedChars: number;
  mappedChars: number;
}

function tallyChapter(md: ReturnType<typeof createMarkdownRenderer>, src: string, t: Tally) {
  const tokens = md.parse(src, {});
  for (let i = 0; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (inline.type !== "inline") continue;
    let owner;
    for (let j = i - 1; j >= 0; j--) {
      const c = tokens[j]!;
      if (c.nesting !== 1 || c.hidden) continue;
      owner = c;
      break;
    }
    if (!owner) continue;
    const text = renderedTextOf(inline);
    if (!text.length) continue;

    t.blocks += 1;
    t.renderedChars += text.length;
    const attr = owner.attrGet(SOURCE_OFFSETS_ATTR);
    if (!attr) continue;
    const covered = mappedLength(decodeSegments(attr));
    t.mapped += 1;
    t.mappedChars += covered;
    if (covered >= text.length) t.full += 1;
  }
}

function chaptersOf(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) continue;
    if (name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

const args = process.argv.slice(2);
const books = (args.length ? args : DEFAULT_BOOKS).map((p) => resolve(p));
const md = createMarkdownRenderer();

const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`);
const total: Tally = { blocks: 0, mapped: 0, full: 0, renderedChars: 0, mappedChars: 0 };

console.log(
  `${"book".padEnd(26)} ${"blocks".padStart(7)} ${"mapped".padStart(8)} ${"full".padStart(8)} ${"chars".padStart(8)}`,
);
for (const dir of books) {
  const t: Tally = { blocks: 0, mapped: 0, full: 0, renderedChars: 0, mappedChars: 0 };
  let chapters: string[];
  try {
    chapters = chaptersOf(dir);
  } catch {
    console.log(`${dir.split("/").pop()!.padEnd(26)}   (not present, skipped)`);
    continue;
  }
  for (const file of chapters) tallyChapter(md, readFileSync(file, "utf8"), t);
  for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += t[k];
  console.log(
    `${dir.split("/").pop()!.padEnd(26)} ${String(t.blocks).padStart(7)} ` +
      `${pct(t.mapped, t.blocks).padStart(8)} ${pct(t.full, t.blocks).padStart(8)} ` +
      `${pct(t.mappedChars, t.renderedChars).padStart(8)}`,
  );
}
console.log(
  `${"ALL".padEnd(26)} ${String(total.blocks).padStart(7)} ` +
    `${pct(total.mapped, total.blocks).padStart(8)} ${pct(total.full, total.blocks).padStart(8)} ` +
    `${pct(total.mappedChars, total.renderedChars).padStart(8)}`,
);
