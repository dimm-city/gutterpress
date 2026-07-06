#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Purity gate for `@dimm-city/print-md/render` (dist/render.js).
//
// The viewer's SPA (root CLAUDE.md §8 / ADR 0004) VALUE-imports this subpath
// into the browser bundle — it must therefore contain zero Node-only code.
// The 2026-07 regression this guards against: building render.ts in the same
// `bun build --splitting` invocation as the Node entrypoints let a shared
// helper chunk (topped with `createRequire(import.meta.url)`) leak into the
// render graph. Production survived only via rollup tree-shaking; `vite dev`
// served the chunk as-is and threw "node:module has been externalized" in
// client code.
//
// render.ts is built as its own NON-SPLIT single-entry graph, so dist/render.js
// is one self-contained file by construction. The gate therefore bans, in that
// one file:
//   - ANY relative import — a `./chunk` import appearing here IS the shared-
//     chunk regression returning, condemned without inspecting the chunk;
//   - any Node builtin specifier, via node:module's isBuiltin() (covers the
//     full, version-accurate list including un-prefixed subpath forms like
//     "fs/promises" and "tty" — never a hand-maintained set);
//   - createRequire anywhere in the text.
// Bare external package specifiers are left external by `--packages=external`
// and cannot be inspected here; a node-only dependency would surface the
// moment `vite dev` resolves it in the viewer, and keeping render.ts's
// dependency list tiny is the real control for that class. (The specifier
// regexes are textual: a string literal that LOOKS like an import could
// false-positive — acceptable for a loud, build-time gate on a 23KB file.)
// ──────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist"),
  "render.js",
);

/** Collect every import/export/require specifier in the module's source. */
function specifiersOf(source) {
  const out = [];
  const patterns = [
    /(?:^|[^\w.])(?:import|export)\s*(?:[\w*\s{},$]+from\s*)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (let m; (m = re.exec(source)); ) out.push(m[1]);
  }
  return out;
}

let source;
try {
  source = readFileSync(entry, "utf8");
} catch {
  console.error(`✖ ${entry} is unreadable — build incomplete?`);
  process.exit(1);
}

const violations = [];
if (/createRequire/.test(source)) {
  violations.push("contains createRequire");
}
for (const spec of specifiersOf(source)) {
  if (isBuiltin(spec)) {
    violations.push(`imports Node builtin "${spec}"`);
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    violations.push(
      `imports relative chunk "${spec}" — render.js must stay a single non-split graph`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    "✖ @dimm-city/print-md/render is no longer node-free/self-contained — the viewer " +
      "SPA value-imports it into the browser bundle (root CLAUDE.md §8):",
  );
  for (const v of violations) console.error("  - " + v);
  console.error(
    "Keep src/render.ts's transitive graph free of node:* / Node builtins, " +
      "and keep its `bun build` invocation separate from the Node entrypoints.",
  );
  process.exit(1);
}

console.log("✓ render subpath is node-free and self-contained (dist/render.js)");
