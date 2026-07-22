/**
 * No unicode-glyph UI chrome (toolbar-refactor): every arrow / check /
 * triangle / star / emoji formerly used as an inline "icon" in Svelte
 * components must be an Icon.svelte SVG instead. This test scans every
 * component's NON-COMMENT source for the banned glyph set so a new one can
 * never sneak back in.
 *
 * Deliberately allowed (typography, not iconography):
 *  - "…" trailing ellipsis on progress labels / menu items / placeholders
 *  - "·" middle-dot metadata separators
 *  - "×" in dimension text ("1024 × 768 px")
 *  - "—", quotes, and other prose punctuation
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

function listSvelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSvelteFiles(full));
    else if (entry.name.endsWith(".svelte")) out.push(full);
  }
  return out;
}

/** Strip HTML comments, block comments, and full-line //- or *-prefixed
 * comment lines, so prose in code comments (legitimately full of arrows)
 * never trips the scan. Line structure is preserved for reporting. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t.startsWith("//") || t.startsWith("*") ? "" : line;
    })
    .join("\n");
}

// Arrows, checks, crosses, geometric triangles, stars, bullets, manual
// chevrons, fullwidth forms, and emoji — the glyph classes that render as UI
// chrome. (Ellipsis …, middle dot ·, and multiplication × are typography and
// stay allowed.)
const BANNED =
  /[←-⇿✓✔✗✘✅❌⭐■-◿★☆•‣◦⋮⋯‹›«»✕✖✎⚙⚠↻⟳＋]|[\u{1F300}-\u{1FAFF}]/u;

describe("no unicode glyphs as UI chrome in Svelte components", () => {
  const files = listSvelteFiles(SRC);

  test("scans a realistic component set", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const file of files) {
    const rel = path.relative(SRC, file);
    test(`${rel} uses SVG icons, not glyph characters`, () => {
      const cleaned = stripComments(fs.readFileSync(file, "utf-8"));
      const lines = cleaned.split("\n");
      const offending = lines
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => BANNED.test(line))
        .map(({ line, n }) => `${rel}:${n}: ${line.trim()}`);
      expect(offending).toEqual([]);
    });
  }
});
