#!/usr/bin/env node
/**
 * Regression test: after `startFolderPreview` throws (bad path, no manifest,
 * etc.), a project-browsing surface MUST be visible so the user can try again.
 *
 * The bug (beta.6 regression): the old `autoOpenPanel` `$effect` was removed
 * without replacement. When the user tried to open a folder that failed (e.g.,
 * a path with no print-md manifest), `currentDir` stayed null but no browsing
 * UI auto-opened — the user was left with a blank welcome screen and no path
 * to try again.
 *
 * Since the start screen (WelcomeLanding) became the app's single empty
 * state, `.projects-body` (ProjectsListBody) is what it hosts: it shows on a
 * fresh launch with no last project, and re-appears when a failed open
 * empties the workspace. The assertions below hold for either surface (start
 * screen or left panel), so this test guards the same "never stranded"
 * contract.
 *
 * What this test verifies:
 *   1. Opens the app with a clean userData (no last project) — a browsing
 *      surface with `.projects-body` shows on startup.
 *   2. Enters a nonexistent path via the location input and presses Enter.
 *   3. Waits for the error to surface (openError, failedOpenDir state).
 *   4. Asserts `.projects-body` is visible again after the failed open.
 *
 * Usage:
 *   node tests/integration/panel-reopen-on-failed-open.pw.mjs [exe-or-main-js]
 * Exit 0 on pass, 1 on fail.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, "..", "..");
const require_ = createRequire(join(viewerDir, "package.json"));
const PORT = 9950 + Math.floor(Math.random() * 40);

const log = (m) => console.log(`[panel-reopen] ${m}`);
let child = null;
let fakeHome = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child?.kill(); } catch {} }
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
}
const fail = (m) => {
  console.error(`[panel-reopen] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. launch the built app ──────────────────────────────────────────────────
const [, , exeArg] = process.argv;
const target = exeArg ? resolve(exeArg) : join(viewerDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, "--no-sandbox"];

fakeHome = mkdtempSync(join(tmpdir(), "pmd-panel-reopen-home-"));
// Fresh userData — no lastProjectDir — so the app shows the welcome Projects panel.

const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
const cmd = useXvfb ? "xvfb-run" : electronBin;
const cmdArgs = useXvfb ? ["-a", "-s", "-screen 0 1600x1000x24", electronBin, ...appArgv] : appArgv;
log(`launching: ${cmd} ${cmdArgs.join(" ")}`);
child = spawn(cmd, cmdArgs, {
  cwd: viewerDir,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: fakeHome,
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    XDG_CACHE_HOME: join(fakeHome, ".cache"),
    XDG_DATA_HOME: join(fakeHome, ".local", "share"),
    ELECTRON_DISABLE_GPU: "1",
  },
});
child.stdout.on("data", () => {});
child.stderr.on("data", () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 2. CDP attach ────────────────────────────────────────────────────────────
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page" && String(t.url).startsWith("app://"));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  fail("CDP endpoint / app:// page never appeared (60s)");
}
const WebSocketImpl =
  globalThis.WebSocket ?? require_("playwright-core/lib/utilsBundle").ws;
const ws = new WebSocketImpl(await getWsUrl());
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    fail(`page eval threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  }
  return r.result?.result?.value;
}
await send("Page.bringToFront");

// ── 3. wait for SPA interactive ──────────────────────────────────────────────
let spaReady = false;
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!document.querySelector('button[aria-label="Toggle left panel"]')`)) {
    spaReady = true;
    break;
  }
  await sleep(1000);
}
if (!spaReady) fail("SPA never became interactive (60s)");
log("SPA ready");

// ── 4. wait for Projects panel to auto-open ───────────────────────────────────
let panelOpen = false;
for (let i = 0; i < 20; i++) {
  const hasPanel = await evalJs(`!!document.querySelector('.projects-body')`);
  if (hasPanel) { panelOpen = true; break; }
  await sleep(500);
}
if (!panelOpen) fail("Projects panel did not auto-open on startup (no .projects-body in 10s)");
log("Projects panel open on startup");

// ── 5. enter a nonexistent path and press Enter ──────────────────────────────
const badPath = "/this-path-does-not-exist-" + Date.now();
await evalJs(`(async () => {
  const inp = document.querySelector('.projects-body .location-input');
  if (!inp) throw new Error('location-input not found');
  inp.focus();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(inp, ${JSON.stringify(badPath)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
log(`submitted bad path: ${badPath}`);

// ── 6. wait for the failed-open error state to surface ───────────────────────
// The error shows as an openError message or a "set up as a book" prompt.
// Either way, the key signal is that busy=false and no preview is loading.
let errorSurfaced = false;
for (let i = 0; i < 30; i++) {
  // The busy spinner (aria-label="Loading") disappears when the open attempt resolves.
  const stillBusy = await evalJs(
    `!!document.querySelector('[aria-label="Loading"][aria-busy="true"]') || !!document.querySelector('.spinner')`
  );
  if (!stillBusy) { errorSurfaced = true; break; }
  await sleep(500);
}
if (!errorSurfaced) fail("App stayed busy for >15s after submitting bad path");
log("error state surfaced (busy resolved)");
await sleep(500); // allow DOM to settle

// ── 7. assert Projects panel is visible ──────────────────────────────────────
const panelStillOpen = await evalJs(`!!document.querySelector('.projects-body')`);
if (!panelStillOpen) {
  fail(
    'Projects panel closed after failed folder open — user is stranded. ' +
    'This is the beta.6 regression: the autoOpenPanel $effect was removed ' +
    'without adding panel re-open to startFolderPreview\'s catch block.'
  );
}

log("PASS — Projects panel visible after failed folder open; catch block restores the panel");
cleanup();
process.exit(0);
