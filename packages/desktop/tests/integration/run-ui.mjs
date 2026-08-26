#!/usr/bin/env node
/**
 * Runs every *.pw.mjs in this directory against the locally-built packaged
 * desktop. Build the app first (`npm run dist:linux` / `:win` / `:mac`), then:
 *
 *   bun run test:ui            # auto-locates the newest packaged app
 *   bun run test:ui -- <exe>   # or point at a specific packaged executable
 *
 * Uses the playwright-core devDependency — no ad-hoc installs, no file copies.
 *
 * The `.pw.mjs` suffix is the CONTRACT, not decoration: every file carrying it
 * is spawned with exactly `(exe, fixture)`, so a script that reads different
 * positional arguments must not carry the suffix — the glob is the only thing
 * deciding what runs here. `app-window.mjs` and `workspace-mode.mjs` are named
 * without the suffix for exactly this reason: they are shared helpers, not
 * drives, and would break if this runner spawned them directly.
 */
import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "..", "dist");

function fail(msg) { console.error(`[run-ui] ${msg}`); process.exit(1); }

/** Locate the packaged executable for the current platform under dist/. */
function locateExe() {
  if (process.argv[2]) return resolve(process.argv[2]);
  if (!existsSync(distDir)) fail(`no dist/ — build first (npm run dist:linux|win|mac). Looked in ${distDir}`);
  const p = platform();
  if (p === "linux") {
    const apps = readdirSync(distDir)
      .filter((f) => f.endsWith(".AppImage"))
      .map((f) => join(distDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (!apps[0]) fail("no *.AppImage in dist/ — run `npm run dist:linux` first");
    return apps[0];
  }
  if (p === "win32") {
    const exe = join(distDir, "win-unpacked", "gutterpress.exe");
    if (!existsSync(exe)) fail("no win-unpacked/gutterpress.exe — run `npm run dist:win` first");
    return exe;
  }
  if (p === "darwin") {
    const macDir = readdirSync(distDir).find((f) => f.startsWith("mac"));
    if (!macDir) fail("no mac* dir in dist/ — run `npm run dist:mac` first");
    const appRoot = join(distDir, macDir);
    const app = readdirSync(appRoot).find((f) => f.endsWith(".app"));
    if (!app) fail(`no .app under ${appRoot}`);
    return join(appRoot, app, "Contents", "MacOS", "gutterpress");
  }
  fail(`unsupported platform: ${p}`);
}

const exe = locateExe();
if (!existsSync(exe)) fail(`packaged executable not found: ${exe}`);
console.log(`[run-ui] packaged app: ${exe}`);

// A real multi-chapter project both tests can open. (electron-driver requires a
// fixture arg; editor-dropdown-sync defaults to this same one.)
const fixture = join(here, "fixtures", "multichapter");

const tests = readdirSync(here)
  .filter((f) => f.endsWith(".pw.mjs"))
  .sort();

let failed = 0;
for (const t of tests) {
  console.log(`\n[run-ui] ── ${t} ──`);
  const r = spawnSync("node", [join(here, t), exe, fixture], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

console.log(`\n[run-ui] ${tests.length - failed}/${tests.length} UI tests passed`);
process.exit(failed ? 1 : 0);
