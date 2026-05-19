#!/usr/bin/env bun
/**
 * Build the Electron main + preload artifacts.
 *
 * Outputs:
 *   electron-dist/main.js         — main process entry (CJS)
 *   electron-dist/preload.js      — preload script (CJS)
 *   electron-dist/package.json    — {"type":"commonjs"} so node treats *.js
 *                                   in this dir as CJS regardless of viewer
 *                                   package.json's outer "type":"module".
 *
 * The lib is shipped normally as a package in node_modules. electron-builder
 * respects packages/lib/package.json's "files" field, so only dist/ and
 * profiles/ get included — not src/, tests/, etc.
 *
 * main.cjs dynamic-imports the lib via `await import('@dimm-city/print-md-lib')`
 * — the Function() trick stops TypeScript's CJS transform from rewriting that
 * to require(), which would fail because the lib is ESM.
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "electron-dist");

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

const expected = ["main.js", "preload.js", "package.json"];
for (const f of expected) {
  const p = join(OUT_DIR, f);
  if (!existsSync(p)) throw new Error(`missing artifact: ${p}`);
}
console.log(`✓ electron-dist ready: ${expected.join(", ")}`);
