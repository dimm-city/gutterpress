#!/usr/bin/env bun
/**
 * Standalone binary compiler for print-md.
 *
 * Wraps `Bun.build({ compile: ... })` and:
 *  - marks lightningcss and fsevents as external; both are optional
 *    native-only deps with pure-JS or platform-specific fallbacks that
 *    bun --compile can't transitively resolve. Rollup's
 *    `@rollup/rollup-<plat>-<arch>` native bindings are *not* externalized
 *    because rollup has no JS fallback and rollup is on the critical path
 *    for vite (preview + html/pdf builds). Bun --compile extracts the
 *    bundled `.node` file at runtime.
 *  - applies a plugin that rewrites a small set of upstream
 *    `JSON.parse(readFileSync(... package.json ...))` patterns into static
 *    JSON literals; see scripts/compile-plugin.ts for why
 *
 * Usage: bun scripts/compile.ts <bun-target> <outfile>
 *   e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64
 */

import { inlinePackageJsonReads } from "./compile-plugin";

const NATIVE_EXTERNALS = [
  // vite: optional CSS processor, ships pure-JS fallback
  "lightningcss",
  // vite/chokidar: macOS file-system events (native kqueue binding); not
  // needed in CLI mode, vite degrades gracefully
  "fsevents",
];

const [target, outfile] = process.argv.slice(2);

if (!target || !outfile) {
  console.error("Usage: bun scripts/compile.ts <bun-target> <outfile>");
  console.error(
    "  e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64"
  );
  process.exit(1);
}

console.log(`Compiling ${target} → ${outfile}`);

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  external: NATIVE_EXTERNALS,
  plugins: [inlinePackageJsonReads],
  compile: {
    target: target as `bun-${string}`,
    outfile,
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const log of result.logs) {
  console.log(log);
}
