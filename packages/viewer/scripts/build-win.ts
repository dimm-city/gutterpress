#!/usr/bin/env bun
/**
 * Windows portable build without Wine.
 *
 * electron-builder's app-builder requires Wine on Linux to patch the Electron
 * PE binary (rename, embed icon). This script builds a portable Windows zip
 * without PE modification — the binary ships as "electron.exe" (cosmetic only;
 * functionality identical). For a branded installer with a custom name/icon,
 * build on Windows or use the GitHub Actions release workflow.
 *
 * The script creates a CLEAN node_modules by running `bun install --production`
 * for only the runtime deps. This avoids the 1+ GB problem caused by following
 * Bun workspace symlinks into the .bun cache.
 *
 * Usage (from packages/viewer/):
 *   bun scripts/build-win.ts
 */

import { mkdir, rm, cp, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";

const ELECTRON_VERSION = "33.4.11";
const ELECTRON_ZIP_NAME = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
const CACHE_ZIP = join(
  process.env.HOME ?? tmpdir(), ".cache", "electron", ELECTRON_ZIP_NAME
);
const ELECTRON_URL =
  `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${ELECTRON_ZIP_NAME}`;

const VIEWER_ROOT = resolve(import.meta.dir, "..");
const CLI_ROOT    = resolve(VIEWER_ROOT, "../../packages/cli");
const DIST_DIR    = join(VIEWER_ROOT, "dist");
const OUT_DIR     = join(DIST_DIR, "win-unpacked");

// Derive the artifact version from package.json so CI version-patch steps
// (which write the tag version into package.json) propagate automatically.
const viewerVersion = JSON.parse(readFileSync(join(VIEWER_ROOT, "package.json"), "utf8")).version as string;
const ZIP_NAME    = `print-md-${viewerVersion}-win32-x64.zip`;
const ZIP_PATH    = join(DIST_DIR, ZIP_NAME);

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

// ── 1. Build SvelteKit server + Electron main ─────────────────────────────
console.log("=== Building SvelteKit server ===");
await run("bun", ["run", "build"], VIEWER_ROOT);
console.log("=== Building Electron main process ===");
await run("bun", ["run", "electron:build"], VIEWER_ROOT);

// ── 2. Download (or reuse) the Windows Electron binary ───────────────────
if (!existsSync(CACHE_ZIP)) {
  await mkdir(join(process.env.HOME ?? tmpdir(), ".cache", "electron"), { recursive: true });
  console.log(`\nDownloading ${ELECTRON_URL} ...`);
  const res = await fetch(ELECTRON_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await Bun.write(CACHE_ZIP, res);
  console.log(`  → cached at ${CACHE_ZIP}`);
} else {
  console.log(`\nReusing cached ${ELECTRON_ZIP_NAME}`);
}

// ── 3. Extract Windows Electron into a fresh win-unpacked dir ─────────────
console.log(`\n=== Extracting ${ELECTRON_ZIP_NAME} ===`);
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await run("unzip", ["-q", CACHE_ZIP, "-d", OUT_DIR]);
console.log(`  → ${OUT_DIR}`);

// ── 4. Inject app code (not node_modules) ────────────────────────────────
const APP_DIR = join(OUT_DIR, "resources", "app");
await mkdir(APP_DIR, { recursive: true });

console.log("\n=== Copying app code ===");
for (const item of ["build", "electron-dist"] as const) {
  const src = join(VIEWER_ROOT, item);
  await cp(src, join(APP_DIR, item), { recursive: true });
  console.log(`  copied: ${item}`);
}

// Copy the CLI source (required by @dimm-city/print-md at runtime).
// Only src/ and the required metadata — skip node_modules/tests/tools.
const CLI_DEST = join(APP_DIR, "node_modules", "@dimm-city", "print-md");
await mkdir(CLI_DEST, { recursive: true });
for (const item of ["src", "profiles", "package.json"] as const) {
  const src = join(CLI_ROOT, item);
  if (!existsSync(src)) continue;
  await cp(src, join(CLI_DEST, item), { recursive: true });
  console.log(`  copied cli/${item}`);
}

// ── 5. Install ONLY runtime dependencies in a temp dir, then copy in ──────
console.log("\n=== Installing production node_modules ===");

// Collect runtime deps from both packages.
const viewerPkg = JSON.parse(readFileSync(join(VIEWER_ROOT, "package.json"), "utf8"));
const cliPkg    = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));

// The app runtime deps: all of CLI's runtime deps + any viewer runtime deps
// (excluding @dimm-city/print-md itself — we copied it directly above).
const runtimeDeps: Record<string, string> = {
  ...(cliPkg.dependencies ?? {}),
  // Remove the workspace self-reference if present
};
delete runtimeDeps["@dimm-city/print-md"];

// Write a minimal package.json in app dir and bun install --production
const appPkg = {
  name: "print-md-app",
  private: true,
  type: "module",
  dependencies: runtimeDeps,
};
await writeFile(join(APP_DIR, "package.json"), JSON.stringify(appPkg, null, 2));

// Run bun install in the app dir to get a clean, flat node_modules
await run("bun", ["install", "--production", "--frozen-lockfile"], APP_DIR);
console.log("  node_modules installed");

// Restore the real viewer package.json after bun install.
const realAppPkg = {
  name: viewerPkg.name,
  private: true,
  type: viewerPkg.type,
  main: viewerPkg.main,
  version: viewerPkg.version,
};
await writeFile(join(APP_DIR, "package.json"), JSON.stringify(realAppPkg, null, 2));

// ── 6. Write electron-dist/package.json (CommonJS marker) ─────────────────
const elDistDir = join(APP_DIR, "electron-dist");
await writeFile(join(elDistDir, "package.json"), JSON.stringify({ type: "commonjs" }));

// ── 7. Zip the result ─────────────────────────────────────────────────────
console.log(`\n=== Creating ${ZIP_NAME} ===`);
await rm(ZIP_PATH, { force: true });
await run("zip", ["-r", "-q", ZIP_PATH, "win-unpacked/"], DIST_DIR);

const stat = await Bun.file(ZIP_PATH).stat();
console.log(`\n✓ ${ZIP_PATH}  (${(stat.size / 1e6).toFixed(1)} MB)\n`);
console.log("Install on Windows:");
console.log(`  1. Unzip ${ZIP_NAME}`);
console.log("  2. Install Bun: https://bun.sh");
console.log("  3. Run electron.exe");
