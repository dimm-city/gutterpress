#!/usr/bin/env bun
/**
 * Standalone binary compiler for print-md.
 *
 * Wraps `Bun.build({ compile: ... })`. The bundle is fully self-contained
 * — no native externals, no `bun patch` files. The narrow rewrite plugin
 * is only there to handle one upstream `package.json` read in stylelint
 * that doesn't survive `import.meta.url` resolution under `--compile`.
 *
 * Usage: bun scripts/compile.ts <bun-target> <outfile>
 *   e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64
 */

import { inlinePackageJsonReads } from "./compile-plugin";

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
