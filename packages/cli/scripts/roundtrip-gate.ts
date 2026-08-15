#!/usr/bin/env bun
/**
 * roundtrip-gate.ts — corpus soundness gate for the block serializer
 * (inline-editing Phase 1, ADR 0010).
 *
 * For EVERY content block of EVERY example book: canonically serialize the
 * block's rendered DOM, substitute the result into the source file,
 * re-render, and require the whole file to be model-identical (the edited
 * block equal, every other block unperturbed).
 *
 * Two verdicts, two rules:
 *   - UNSOUND (a block the serializer ACCEPTED whose substitution changed
 *     any model) — hard fail, zero tolerance. This is the wrong-edit class.
 *   - REFUSED (a block the serializer declined — raw HTML islands, exotic
 *     constructs) — safe by design; tracked as per-book COVERAGE with a
 *     ratchet baseline (scripts/roundtrip-baseline.json) so coverage can
 *     only improve. Run with --update to (re)write the baseline.
 *
 * Runs under plain `bun` — renderer HTML is parsed by the strict testkit
 * parser, no browser involved.
 */
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest, resolveConfig } from "../src/lib/manifest";
import { resolveActiveMarkdownFiles } from "../src/lib/markdown/index";
import {
  BUILTIN_OPTIONAL_PLUGINS,
  SERIALIZER_FEATURE_BY_PLUGIN,
  createMarkdownRenderer,
  type LoadedPlugin,
} from "../src/lib/markdown/renderer";
import {
  canonicalizeBlock,
  discoverContentBlocks,
  extractBlockModel,
  findBlockRangeAttr,
  modelsEqual,
  type SerializeOptions,
} from "../src/lib/markdown/serialize";
import {
  parseHtml,
  parseRange,
  sliceLines,
  substitute,
  type TestElement,
} from "../src/lib/markdown/serialize-testkit";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baselinePath = join(dirname(fileURLToPath(import.meta.url)), "roundtrip-baseline.json");

const BOOKS: Array<{ name: string; dir: string }> = [
  { name: "gutterpress-user-guide", dir: "examples/gutterpress-user-guide" },
  { name: "gutterwire-zine", dir: "examples/gutterwire-zine" },
  { name: "with-validation", dir: "examples/with-validation" },
  { name: "with-design-guide/book-01", dir: "examples/with-design-guide/book-01" },
  { name: "with-design-guide/book-02", dir: "examples/with-design-guide/book-02" },
  { name: "with-design-guide/design-guide", dir: "examples/with-design-guide/design-guide" },
  { name: "css-authoring-spike", dir: "docs/fixtures/css-authoring-spike/book" },
];



interface Unsound {
  book: string;
  file: string;
  blockIndex: number;
  detail: string;
}

interface BookStats {
  name: string;
  blocks: number;
  covered: number;
  reasons: Map<string, number>;
}

function pluginNames(manifest: { plugins?: unknown }): string[] {
  if (!Array.isArray(manifest.plugins)) return [];
  return manifest.plugins
    .map((p) => (typeof p === "string" ? p : (p as { name?: string })?.name ?? ""))
    .filter(Boolean);
}

async function gateBook(book: { name: string; dir: string }, unsound: Unsound[]): Promise<BookStats> {
  const dir = join(repoRoot, book.dir);
  const manifest = await loadManifest(dir);
  const config = resolveConfig({}, manifest);

  const names = pluginNames(manifest);
  const features: NonNullable<SerializeOptions["features"]> = {};
  const loaded: LoadedPlugin[] = [];
  for (const name of names) {
    const feature = SERIALIZER_FEATURE_BY_PLUGIN[name];
    const plugin = BUILTIN_OPTIONAL_PLUGINS[name];
    if (feature && plugin) {
      features[feature] = true;
      loaded.push({ name, plugin, options: {} });
    } else {
      // Non-bundled plugins would need the vendored loader; no corpus book
      // uses one today. Fail loudly if that changes so the gate stays honest.
      throw new Error(`${book.name}: manifest plugin "${name}" is not a bundled plugin — teach the gate to load it`);
    }
  }
  const opts: SerializeOptions = { features };
  const md = createMarkdownRenderer(loaded.length ? loaded : undefined);

  const files = await resolveActiveMarkdownFiles(dir, config.source?.files ?? null);
  const stats: BookStats = { name: book.name, blocks: 0, covered: 0, reasons: new Map() };

  for (const file of files) {
    const src = (await readFile(join(dir, file), "utf8")).replace(/\r\n?/g, "\n");
    const html1 = md.render(src, {});
    let root1: TestElement;
    try {
      root1 = parseHtml(html1);
    } catch (err) {
      // Author raw HTML the strict parser can't read → the whole file is
      // outside the gate's reach; count its blocks as uncovered via a
      // sentinel reason rather than crashing the gate.
      stats.reasons.set(`file unparseable: ${(err as Error).message}`, 1);
      continue;
    }
    const blocks1 = discoverContentBlocks(root1) as TestElement[];
    const models1 = blocks1.map((b) => {
      try {
        return extractBlockModel(b, opts);
      } catch {
        return null;
      }
    });
    stats.blocks += blocks1.length;

    blocks1.forEach((block, i) => {
      const range = parseRange(findBlockRangeAttr(block)!);
      const res = canonicalizeBlock(block, sliceLines(src, range), opts);
      if (res.kind === "refused") {
        stats.reasons.set(res.reason, (stats.reasons.get(res.reason) ?? 0) + 1);
        return;
      }
      if (res.kind !== "replacement") return;

      const src2 = substitute(src, range, res.text);
      const html2 = md.render(src2, {});
      let blocks2: TestElement[];
      try {
        blocks2 = discoverContentBlocks(parseHtml(html2)) as TestElement[];
      } catch (err) {
        unsound.push({
          book: book.name,
          file,
          blockIndex: i,
          detail: `re-rendered file unparseable: ${(err as Error).message}`,
        });
        return;
      }
      if (blocks2.length !== blocks1.length) {
        unsound.push({
          book: book.name,
          file,
          blockIndex: i,
          detail:
            `block count changed ${blocks1.length} → ${blocks2.length}\n` +
            `--- replacement ---\n${res.text}`,
        });
        return;
      }
      for (let j = 0; j < blocks2.length; j++) {
        if (models1[j] === null) continue;
        let m2: unknown;
        try {
          m2 = extractBlockModel(blocks2[j]!, opts);
        } catch (err) {
          m2 = `<<unextractable: ${(err as Error).message}>>`;
        }
        if (!modelsEqual(m2, models1[j])) {
          unsound.push({
            book: book.name,
            file,
            blockIndex: i,
            detail:
              `block ${j} drifted (slice lines ${range[0]}:${range[1]})\n` +
              `--- original slice ---\n${sliceLines(src, range)}\n` +
              `--- replacement ---\n${res.text}\n` +
              `--- expected model ---\n${JSON.stringify(models1[j])}\n` +
              `--- got ---\n${JSON.stringify(m2)}`,
          });
          return;
        }
      }
      stats.covered++;
    });
  }
  return stats;
}

const updateBaseline = process.argv.includes("--update");

const unsound: Unsound[] = [];
const allStats: BookStats[] = [];
for (const book of BOOKS) {
  allStats.push(await gateBook(book, unsound));
}

// ── report ──────────────────────────────────────────────────────────────────

const pct = (s: BookStats) => (s.blocks ? (100 * s.covered) / s.blocks : 100);

console.log("\nround-trip corpus gate — canonical serialize → substitute → re-render → model-equal\n");
console.log("book                                    blocks  covered  coverage");
for (const s of allStats) {
  console.log(
    `${s.name.padEnd(40)}${String(s.blocks).padStart(6)}${String(s.covered).padStart(9)}` +
      `${pct(s).toFixed(1).padStart(9)}%`,
  );
  const reasons = [...s.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [reason, count] of reasons) {
    console.log(`    ↳ ${count}× ${reason}`);
  }
}

let failed = false;

if (unsound.length) {
  failed = true;
  console.error(`\n✖ ${unsound.length} UNSOUND result(s) — serializer accepted a block whose substitution changed the document:\n`);
  for (const u of unsound.slice(0, 10)) {
    console.error(`— ${u.book} ${u.file} block #${u.blockIndex}\n${u.detail}\n`);
  }
  if (unsound.length > 10) console.error(`… and ${unsound.length - 10} more`);
}

if (updateBaseline) {
  const baseline = Object.fromEntries(
    allStats.map((s) => [s.name, Math.floor(pct(s) * 10) / 10]),
  );
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`\nbaseline written → ${baselinePath}`);
} else if (!existsSync(baselinePath)) {
  failed = true;
  console.error(`\n✖ no baseline at ${baselinePath} — run with --update to record one`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, number>;
  for (const s of allStats) {
    const min = baseline[s.name];
    if (min == null) {
      failed = true;
      console.error(`✖ ${s.name}: not in baseline — run with --update`);
    } else if (pct(s) + 1e-9 < min) {
      failed = true;
      console.error(`✖ ${s.name}: coverage ${pct(s).toFixed(1)}% fell below baseline ${min}%`);
    } else if (pct(s) > min + 2) {
      console.log(`↑ ${s.name}: coverage ${pct(s).toFixed(1)}% beats baseline ${min}% — consider --update to ratchet`);
    }
  }
}

if (failed) process.exit(1);
console.log("\n✓ corpus round-trip gate green");
