#!/usr/bin/env bun
/**
 * Build the Electron main+preload artifacts AND bundle the lib alongside.
 *
 * Outputs:
 *   electron-dist/main.js         — main process entry (CJS)
 *   electron-dist/preload.js      — preload script (CJS)
 *   electron-dist/lib.cjs         — bundled @dimm-city/print-md-lib (CJS)
 *   electron-dist/package.json    — {"type":"commonjs"}
 *
 * The lib is bundled so main.ts can `require()` it directly with no
 * node_modules/@dimm-city/print-md-lib package on disk. This eliminates
 * the afterPack workspace-symlink + npm-install dance that caused the
 * beta.11 "Cannot find package '@dimm-city/print-md-lib'" failure on
 * Windows.
 *
 * Native modules (chokidar's fsevents, etc.) and large optional deps
 * (puppeteer-core) stay external. electron-builder bundles them via the
 * normal node_modules path; we never touch that node_modules tree from
 * an afterPack hook anymore.
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "electron-dist");
const LIB_ROOT = resolve(ROOT, "..", "lib");
const LIB_ENTRY = join(LIB_ROOT, "src", "api", "index.ts");

// Native or heavy optional deps — let Node resolve them at runtime from
// node_modules. They're already installed by electron-builder's normal
// packaging flow (the viewer's `dependencies` and `optionalDependencies`).
const EXTERNALS = [
  // Native bindings
  "fsevents",
  "@parcel/watcher",
  // Heavy and rarely used
  "puppeteer-core",
  // Lint-only — never reached from the viewer
  "stylelint",
  "stylelint-config-standard",
  "markdownlint-cli2",
  "htmlhint",
  // Electron itself (just in case anything pulls it transitively)
  "electron",
];

async function step(name: string, fn: () => void | Promise<void>) {
  process.stdout.write(`▸ ${name}…`);
  await fn();
  process.stdout.write(" ok\n");
}

await step("clean electron-dist", () => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
});

await step("compile main + preload (tsc)", () => {
  const result = spawnSync(
    "bun",
    ["x", "tsc", "-p", "electron/tsconfig.json"],
    { cwd: ROOT, stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(`tsc exited with code ${result.status}`);
  }
});

await step("write electron-dist/package.json", () => {
  writeFileSync(
    join(OUT_DIR, "package.json"),
    JSON.stringify({ type: "commonjs" }) + "\n"
  );
});

await step("bundle lib (esm → cjs)", async () => {
  if (!existsSync(LIB_ENTRY)) {
    throw new Error(`lib entry not found: ${LIB_ENTRY}`);
  }
  const result = await Bun.build({
    entrypoints: [LIB_ENTRY],
    outdir: OUT_DIR,
    naming: "lib.cjs",
    target: "node",
    format: "cjs",
    external: EXTERNALS,
    sourcemap: "none",
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("lib bundle failed");
  }
});

// Confirm artifacts exist before exiting.
const expected = ["main.js", "preload.js", "lib.cjs", "package.json"];
for (const f of expected) {
  const p = join(OUT_DIR, f);
  if (!existsSync(p)) throw new Error(`missing artifact: ${p}`);
}
console.log(`✓ electron-dist ready: ${expected.join(", ")}`);
