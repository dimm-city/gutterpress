#!/usr/bin/env node
/**
 * Generates the synthetic perf-gate fixture book: a plain folder of markdown
 * chapters big enough to take paged.js well over a measurement window
 * (~150+ rendered pages). Idempotent — skips generation when the folder
 * already exists with the expected chapter count (pass --force to regenerate).
 *
 * Output: tests/perf/.fixture-book/ (gitignored, generated content only).
 * Used by render-gate.mjs; safe to delete at any time.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, ".fixture-book");

const CHAPTERS = 14;
const SECTIONS_PER_CHAPTER = 16;
const PARAS_PER_SECTION = 6;

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. Duis aute irure dolor in reprehenderit in voluptate " +
  "velit esse cillum.";

export function generateFixtureBook({ force = false } = {}) {
  if (!force && existsSync(FIXTURE_DIR)) {
    const mds = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".md"));
    if (mds.length === CHAPTERS) return FIXTURE_DIR; // already generated
  }
  // Regenerating our own generated output — always safe (created by this script).
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  for (let c = 1; c <= CHAPTERS; c++) {
    const lines = [`# Chapter ${c}`, ""];
    for (let s = 1; s <= SECTIONS_PER_CHAPTER; s++) {
      lines.push(`## Section ${c}.${s}`, "");
      for (let p = 0; p < PARAS_PER_SECTION; p++) lines.push(LOREM, "");
      lines.push(`- item one of section ${s}`, "- item two", "- item three", "");
    }
    writeFileSync(join(FIXTURE_DIR, `${String(c).padStart(2, "0")}-chapter.md`), lines.join("\n"));
  }
  return FIXTURE_DIR;
}

// CLI entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = generateFixtureBook({ force: process.argv.includes("--force") });
  console.log(`[make-fixture-book] fixture ready: ${dir}`);
}
