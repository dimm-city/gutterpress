#!/usr/bin/env bun
/**
 * Windows viewer build.
 *
 * electron-builder handles: Electron binary download + cache, exe rename
 * (productName → print-md-viewer.exe), icon embedding (win.icon), app layout,
 * and zip creation.
 *
 * The only manual step is fixing the Bun workspace symlink:
 * node_modules/@dimm-city/print-md → packages/cli (full source + devDeps).
 * We replace it with only the compiled dist/ output and install the CLI's
 * production deps before handing off to electron-builder.
 *
 * Flow:
 *   1. Build CLI lib (dist/) + SvelteKit server + Electron main
 *   2. electron-builder --win dir  (unpacks, renames exe, embeds icon)
 *   3. Replace CLI in unpacked app/node_modules with dist/ only
 *   4. Install CLI runtime deps in the unpacked app directory
 *   5. electron-builder --prepackaged  (creates the zip)
 *
 * Usage (from packages/viewer/):
 *   bun scripts/build-win.ts
 */

import { mkdir, rm, cp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

const VIEWER_ROOT = resolve(import.meta.dirname, "..");
const CLI_ROOT    = resolve(VIEWER_ROOT, "../../packages/cli");
const UNPACKED    = join(VIEWER_ROOT, "dist", "win-unpacked");
const APP_DIR     = join(UNPACKED, "resources", "app");

async function run(cmd: string, args: string[], cwd?: string) {
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd} exited ${code}`);
}

// ── 1. Build ───────────────────────────────────────────────────────────────
console.log("=== Building CLI lib (Node.js dist/) ===");
await run("bun", ["run", "build:lib"], CLI_ROOT);

console.log("\n=== Building SvelteKit + Electron main ===");
await run("bun", ["run", "build"], VIEWER_ROOT);
await run("bun", ["run", "electron:build"], VIEWER_ROOT);

// ── 2. electron-builder: create unpacked app ───────────────────────────────
// Handles: Electron binary download + cache, exe rename (productName),
// icon embedding (win.icon), app directory structure.
console.log("\n=== electron-builder: pack to directory ===");
await run("bunx", ["electron-builder", "--win", "dir", "--config", "electron-builder.yml"], VIEWER_ROOT);

// ── 3. Replace workspace-symlinked CLI with compiled dist/ ─────────────────
// electron-builder followed packages/cli symlink and copied the full tree
// (including playwright, stylelint devDeps). Replace with dist/ only.
console.log("\n=== Replacing CLI with compiled dist/ ===");
const CLI_DEST = join(APP_DIR, "node_modules", "@dimm-city", "print-md");
await rm(CLI_DEST, { recursive: true, force: true });
await mkdir(CLI_DEST, { recursive: true });
for (const item of ["dist", "profiles", "package.json"] as const) {
  const src = join(CLI_ROOT, item);
  if (existsSync(src)) await cp(src, join(CLI_DEST, item), { recursive: true });
}
console.log("  replaced with dist/ + profiles/ + package.json");

// ── 4. Install CLI runtime deps ────────────────────────────────────────────
// ws, chokidar, yaml, markdown-it, puppeteer-core, etc. need to be in
// node_modules alongside the compiled CLI dist/.
console.log("\n=== Installing CLI runtime deps ===");
const viewerPkg = JSON.parse(readFileSync(join(VIEWER_ROOT, "package.json"), "utf8"));
const cliPkg    = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
const runtimeDeps: Record<string, string> = { ...(cliPkg.dependencies ?? {}) };
delete runtimeDeps["@dimm-city/print-md"];

const tmpPkg = {
  name: "print-md-app",
  private: true,
  type: viewerPkg.type ?? "module",
  main: viewerPkg.main,
  version: viewerPkg.version,
  dependencies: runtimeDeps,
};
await writeFile(join(APP_DIR, "package.json"), JSON.stringify(tmpPkg, null, 2));
await run("bun", ["install", "--production"], APP_DIR);

// Restore a minimal real package.json.
await writeFile(join(APP_DIR, "package.json"), JSON.stringify({
  name: viewerPkg.name,
  private: true,
  type: viewerPkg.type,
  main: viewerPkg.main,
  version: viewerPkg.version,
}, null, 2));
console.log("  done");

// ── 5. Zip from the corrected unpacked directory ───────────────────────────
console.log("\n=== electron-builder: create zip ===");
await run("bunx", [
  "electron-builder", "--prepackaged", UNPACKED, "--win", "zip",
  "--config", "electron-builder.yml",
], VIEWER_ROOT);
console.log("\n✓ dist/ contains the Windows zip");
