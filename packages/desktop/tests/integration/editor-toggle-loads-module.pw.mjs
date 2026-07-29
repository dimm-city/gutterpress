#!/usr/bin/env node
/**
 * Regression test: clicking the "Toggle markdown editor" button MUST load the
 * editor module (CodeMirror), not leave the pane stuck at "Loading editor…".
 *
 * The bug (beta.6 regression): `toggleEditor()` set `editorOpen = true` but
 * never called `loadEditorModule()`. The lazy import was only triggered from
 * file-tree clicks (`onSelectEditorFile`). Opening the editor via the toolbar
 * button without first clicking a file left the pane in the "Loading editor…"
 * state indefinitely.
 *
 * What this test verifies:
 *   1. Opens the app with a fresh userData that auto-opens the multichapter
 *      fixture and sets the left panel to the Files tab (so no file has been
 *      clicked — module not pre-loaded).
 *   2. Waits for the first preview render to complete.
 *   3. Clicks the "Toggle markdown editor" toolbar button.
 *   4. Asserts `.cm-editor` is present in the DOM within 10 s — i.e., the
 *      module loaded and CodeMirror mounted.
 *   5. Asserts "Loading editor…" text is NOT visible.
 *
 * Usage:
 *   node tests/integration/editor-toggle-loads-module.pw.mjs [exe-or-main-js] [fixture-dir]
 * Exit 0 on pass, 1 on fail.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const PORT = 9900 + Math.floor(Math.random() * 150);

const log = (m) => console.log(`[editor-toggle] ${m}`);
let child = null;
let fakeHome = null;
let bookDir = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child?.kill(); } catch {} }
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  try { if (bookDir) rmSync(bookDir, { recursive: true, force: true }); } catch {}
}
const fail = (m) => {
  console.error(`[editor-toggle] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. fixture copy ──────────────────────────────────────────────────────────
const [, , exeArg, fixtureArg] = process.argv;
const srcFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(srcFixture)) fail(`fixture not found: ${srcFixture}`);
 bookDir = mkdtempSync(join(tmpdir(), "gutterpress-editortoggle-"));
cpSync(srcFixture, bookDir, { recursive: true });
log(`fixture: ${bookDir}`);

// ── 2. launch the built app ──────────────────────────────────────────────────
const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, "--no-sandbox"];

 fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-editortoggle-home-"));
// Use --user-data-dir to point Electron at a throwaway userData directory.
// Write gutterpress-prefs.json there with the fixture path and Files tab (NOT toc)
// so no file has been clicked yet — the editor module hasn't been pre-loaded.
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: bookDir,
    leftPanel: { open: true, activeTab: "files", width: 280 },
  }),
);
appArgv.push(`--user-data-dir=${userDataDir}`);

const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
const cmd = useXvfb ? "xvfb-run" : electronBin;
const cmdArgs = useXvfb ? ["-a", "-s", "-screen 0 1600x1000x24", electronBin, ...appArgv] : appArgv;
log(`launching: ${cmd} ${cmdArgs.join(" ")}`);
child = spawn(cmd, cmdArgs, {
  cwd: desktopDir,
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

// ── 3. CDP attach ────────────────────────────────────────────────────────────
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

// ── 4. wait for SPA interactive ───────────────────────────────────────────────
let spaReady = false;
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!document.querySelector('button[aria-label="Toggle markdown editor"]')`)) {
    spaReady = true;
    break;
  }
  await sleep(1000);
}
if (!spaReady) fail("SPA never became interactive (editor toggle button not found in 60s)");
log("SPA ready");

// ── 5. wait for at least a file item (project opened) ────────────────────────
let projectOpen = false;
for (let i = 0; i < 120; i++) {
  const open = await evalJs(`!!(document.querySelector('.toc-item') || document.querySelector('.file-item'))`);
  if (open) { projectOpen = true; break; }
  await sleep(1000);
}
if (!projectOpen) fail("project never opened (no file/TOC items in 120s)");
log("project opened — editor module NOT yet loaded (no file clicked)");

// Confirm the editor pane shows "Loading editor…" BEFORE the toggle click —
// this would have been visible forever in the beta.6 regression.
const moduleLoadedPreClick = await evalJs(`!!document.querySelector('.cm-editor')`);
if (moduleLoadedPreClick) {
  // Module somehow pre-loaded (possibly a race with auto-open heuristic). The
  // fix is still correct, but we can't isolate the regression with this run.
  log("NOTE: editor module pre-loaded before toggle click — regression isolation unclear");
}

// ── 6. click the Toggle markdown editor button ────────────────────────────────
await evalJs(`document.querySelector('button[aria-label="Toggle markdown editor"]').click(); true`);
log("Toggle markdown editor clicked");

// ── 7. wait for .cm-editor to appear (max 10s) ────────────────────────────────
let editorLoaded = false;
for (let i = 0; i < 20; i++) {
  const hasCm = await evalJs(`!!document.querySelector('.cm-editor')`);
  if (hasCm) { editorLoaded = true; break; }
  await sleep(500);
}

const stuckOnLoading = await evalJs(
  `[...document.querySelectorAll('.editor-loading')].some(el => el.textContent.includes('Loading editor'))`
);

if (!editorLoaded) {
  if (stuckOnLoading) {
    fail('Editor pane is stuck on "Loading editor…" after toggle click — module never loaded. This is the beta.6 regression: toggleEditor() must call loadEditorModule().');
  }
  fail("No .cm-editor element after 10s — editor did not load after toggle click");
}
if (stuckOnLoading) {
  fail('"Loading editor…" still visible alongside .cm-editor — unexpected state');
}

log("PASS — .cm-editor appeared within 10s of toggle click; loadEditorModule() was called");
cleanup();
process.exit(0);
