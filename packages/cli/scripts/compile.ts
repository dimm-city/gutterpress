#!/usr/bin/env bun
/**
 * Standalone binary compiler for print-md.
 *
 * Wraps `Bun.build({ compile: ... })`. The bundle is fully self-contained —
 * no native externals, no `bun patch` files, no source rewrites. (stylelint,
 * which needed runtime-`require` rewrites to survive `--compile`, was removed;
 * CSS print-safety checks now run on postcss, which bundles cleanly.)
 *
 * Usage: bun scripts/compile.ts <bun-target> <outfile>
 *   e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64
 */

const [target, outfile] = process.argv.slice(2);

if (!target || !outfile) {
  console.error("Usage: bun scripts/compile.ts <bun-target> <outfile>");
  console.error(
    "  e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64"
  );
  process.exit(1);
}

console.log(`Compiling ${target} → ${outfile}`);

// Bake the real version into the binary (it can't read package.json at runtime).
const { version } = (await Bun.file("package.json").json()) as { version: string };

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  define: { __PMD_VERSION__: JSON.stringify(version) },
  compile: {
    target: target as import("bun").Build.Target,
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
