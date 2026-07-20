#!/usr/bin/env node
/**
 * App-token inventory checker — enforces theme.css's admission rule.
 *
 * Fails when:
 *  1. any `var(--app-…)` in the SPA references a token that theme.css does
 *     not define (the "phantom token" class of bug: the var() fallback wins
 *     silently and the element opts out of theming — this shipped a real
 *     light-theme bug in EditorToolbar before this check existed);
 *  2. any token defined in theme.css has zero consumers (dead inventory —
 *     delete the token when removing its last consumer).
 *
 * Component-private values (single consumer, no shared semantics) should not
 * be tokens at all — use `light-dark(lightValue, darkValue)` locally instead;
 * see theme.css's header for the full rule.
 *
 * Usage: node tools/check-app-tokens.mjs   (run from packages/viewer)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const viewerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const themeCss = join(viewerRoot, "src", "lib", "theme.css");
const srcRoot = join(viewerRoot, "src");

/** Tokens defined in theme.css (both palettes define the same names; a set suffices). */
const defined = new Set(
  [...readFileSync(themeCss, "utf8").matchAll(/(--app-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
);

/** Recursively collect scannable source files. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(svelte|css|ts|js)$/.test(entry)) out.push(p);
  }
  return out;
}

const used = new Map(); // token -> [file:line, …]
for (const file of walk(srcRoot)) {
  // Blank out /* … */ comments (line structure preserved) so prose examples
  // like theme.css's own `calc(var(--app-z-…) ± n)` don't count as usage.
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " ")
  );
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--app-[a-z0-9-]+)/g)) {
      const token = m[1];
      if (!used.has(token)) used.set(token, []);
      used.get(token).push(`${relative(viewerRoot, file)}:${i + 1}`);
    }
  });
}

let failed = false;

const phantoms = [...used.keys()].filter((t) => !defined.has(t)).sort();
if (phantoms.length) {
  failed = true;
  console.error("✖ Undefined app tokens referenced (fallbacks silently win — the element never themes):");
  for (const t of phantoms) console.error(`    ${t}\n      ${used.get(t).join("\n      ")}`);
}

const dead = [...defined].filter((t) => !used.has(t)).sort();
if (dead.length) {
  failed = true;
  console.error("✖ Tokens defined in theme.css with zero consumers (delete them, or use them):");
  for (const t of dead) console.error(`    ${t}`);
}

if (failed) {
  console.error("\nSee the admission rule in src/lib/theme.css's header.");
  process.exit(1);
}
console.log(`✓ app tokens OK — ${defined.size} defined, all consumed; no phantom references.`);
