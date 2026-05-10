#!/usr/bin/env bun
/**
 * Standalone binary compiler for print-md.
 *
 * Wraps `bun build --compile` and marks all known native-only optional packages
 * as external so the bundler doesn't try to resolve them. Vite and rollup have
 * pure-JS fallbacks for all of these; they degrade gracefully at runtime.
 *
 * Usage: bun scripts/compile.ts <bun-target> <outfile>
 *   e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64
 */

const NATIVE_EXTERNALS = [
  // vite: optional CSS processor
  "lightningcss",
  // vite/chokidar: macOS file-system events (native kqueue binding)
  "fsevents",
  // rollup: platform-specific native performance bindings
  // rollup ships pure-JS/WASM fallbacks when these are absent
  "@rollup/rollup-android-arm-eabi",
  "@rollup/rollup-android-arm64",
  "@rollup/rollup-darwin-arm64",
  "@rollup/rollup-darwin-x64",
  "@rollup/rollup-freebsd-arm64",
  "@rollup/rollup-freebsd-x64",
  "@rollup/rollup-linux-arm-gnueabihf",
  "@rollup/rollup-linux-arm-musleabihf",
  "@rollup/rollup-linux-arm64-gnu",
  "@rollup/rollup-linux-arm64-musl",
  "@rollup/rollup-linux-powerpc64le-gnu",
  "@rollup/rollup-linux-riscv64-gnu",
  "@rollup/rollup-linux-riscv64-musl",
  "@rollup/rollup-linux-s390x-gnu",
  "@rollup/rollup-linux-x64-gnu",
  "@rollup/rollup-linux-x64-musl",
  "@rollup/rollup-win32-arm64-msvc",
  "@rollup/rollup-win32-ia32-msvc",
  "@rollup/rollup-win32-x64-msvc",
];

const [target, outfile] = process.argv.slice(2);

if (!target || !outfile) {
  console.error("Usage: bun scripts/compile.ts <bun-target> <outfile>");
  console.error("  e.g. bun scripts/compile.ts bun-linux-x64 print-md-linux-x64");
  process.exit(1);
}

const externalFlags = NATIVE_EXTERNALS.flatMap((pkg) => ["--external", pkg]);

const cmd = [
  "bun",
  "build",
  "src/cli.ts",
  "--compile",
  `--target=${target}`,
  `--outfile=${outfile}`,
  ...externalFlags,
];

console.log(`Compiling ${target} → ${outfile}`);
console.log(cmd.join(" "));

const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
const exitCode = await proc.exited;
process.exit(exitCode);
