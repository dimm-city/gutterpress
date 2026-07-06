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
// client code. render.ts is now built as its own non-split graph, and this
// script fails the lib build if any Node-ism ever reappears in that closure.
//
// Builtin detection uses node:module's isBuiltin(), which covers the full,
// version-accurate list including un-prefixed subpath forms ("fs/promises",
// "path/posix", "tty", …) — never a hand-maintained set. Bare external
// package specifiers are left external by `--packages=external` and cannot be
// walked here; a node-only dependency would surface the moment `vite dev`
// resolves it in the viewer, and keeping render.ts's dependency list tiny is
// the real control for that class.
// ──────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const entry = join(distDir, "render.js");

/** Collect every import/export specifier in a module's source. */
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

const violations = [];
const visited = new Set();
const queue = [entry];

while (queue.length > 0) {
  const file = queue.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    violations.push(`${file}: unreadable (build incomplete?)`);
    continue;
  }
  if (/createRequire/.test(source)) {
    violations.push(`${file}: contains createRequire`);
  }
  for (const spec of specifiersOf(source)) {
    if (isBuiltin(spec)) {
      violations.push(`${file}: imports Node builtin "${spec}"`);
    } else if (spec.startsWith("./") || spec.startsWith("../")) {
      queue.push(resolve(dirname(file), spec));
    }
  }
}

if (violations.length > 0) {
  console.error(
    "✖ @dimm-city/print-md/render is no longer node-free — the viewer SPA " +
      "value-imports it into the browser bundle (root CLAUDE.md §8):",
  );
  for (const v of violations) console.error("  - " + v);
  console.error(
    "Keep src/render.ts's transitive graph free of node:* / Node builtins, " +
      "and keep its `bun build` invocation separate from the Node entrypoints.",
  );
  process.exit(1);
}

console.log(
  `✓ render subpath is node-free (${visited.size} file(s) in dist/render.js closure)`,
);
