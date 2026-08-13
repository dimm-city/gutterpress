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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const PORT = 9900 + Math.floor(Math.random() * 150);
const MAX_SAVE_TO_VISIBLE_MS = 3000;

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
// This regression specifically verifies that a configured delay reaches the
// buffer instead of falling back to 500 ms. Keep it distinct from the product
// default so autosave cannot win before the Save-button assertion.
writeFileSync(
  join(userDataDir, "app-settings.json"),
  JSON.stringify({ settingsSchemaVersion: 2, editor: { autoSaveDelay: 2500 } }),
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
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);

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

// Auto-open leaves the welcome layer over the pre-rendered workspace. Dismiss
// it before exercising real keyboard input; the layer correctly makes the
// workspace inert while visible, and programmatic .click() alone bypasses that.
await evalJs(`document.querySelector('button[aria-label="Close this screen"]')?.click(); true`);
for (let i = 0; i < 20; i++) {
  if (!(await evalJs(`!!document.querySelector('.app-root[inert]')`))) break;
  await sleep(50);
}
if (await evalJs(`!!document.querySelector('.app-root[inert]')`)) {
  fail("welcome layer did not release the workspace before editor interaction");
}

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

// ── 8. packaged source-save path ─────────────────────────────────────────────
// This test explicitly configures 2.5 s. A regression left EditorBuffer on its 500 ms
// fallback, making the main Save button look permanently disabled and turning
// Ctrl+S into an apparent no-op because autosave had already won the race.
const chapterName = readdirSync(bookDir).sort().find((name) => name.endsWith(".md") && name !== "README.md");
if (!chapterName) fail(`fixture has no markdown chapter under ${bookDir}`);
const chapterPath = join(bookDir, chapterName);
const chapterBefore = readFileSync(chapterPath, "utf8");
const marker = `packaged-save-${Date.now()}`;
const editorPoint = await evalJs(`(() => {
  const rect = document.querySelector('.cm-content').getBoundingClientRect();
  return { x: rect.left + Math.min(80, rect.width / 2), y: rect.top + Math.min(20, rect.height / 2) };
})()`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...editorPoint });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...editorPoint });
const documentEndKey = process.platform === "darwin"
  ? { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, modifiers: 4 }
  : { key: "End", code: "End", windowsVirtualKeyCode: 35, modifiers: 2 };
await send("Input.dispatchKeyEvent", { type: "keyDown", ...documentEndKey });
await send("Input.dispatchKeyEvent", { type: "keyUp", ...documentEndKey });
await send("Input.insertText", { text: `\n\n${marker}\n` });
const editorReceivedMarker = await evalJs(
  `document.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(marker)})`,
);
if (!editorReceivedMarker) {
  const diagnostics = await evalJs(`(() => {
    const content = document.querySelector('.cm-content');
    return {
      activeClass: document.activeElement?.className ?? null,
      contentEditable: content?.getAttribute('contenteditable') ?? null,
      inertAncestor: !!content?.closest('[inert]'),
      rect: content ? { width: content.getBoundingClientRect().width, height: content.getBoundingClientRect().height } : null,
    };
  })()`);
  fail(`CDP text insertion did not change the CodeMirror document (${JSON.stringify(diagnostics)})`);
}

// Wait past the old hard-coded 500 ms fallback while remaining well inside the
// configured 2.5 s window. Save must still be available and disk untouched.
await sleep(750);
let saveEnabled = false;
for (let i = 0; i < 20; i++) {
  saveEnabled = await evalJs(`document.querySelector('header.toolbar button.save-btn')?.disabled === false`);
  if (saveEnabled) break;
  await sleep(25);
}
if (!saveEnabled) fail("main Save button did not enable after a CodeMirror edit");
if (readFileSync(chapterPath, "utf8") !== chapterBefore) {
  fail("chapter autosaved before the configured 2.5 s delay elapsed");
}

await evalJs(`(() => {
  window.__gutterpressSavePreviewProbe = { startedAt: performance.now(), result: null, sequence: 0 };
  if (window.__gutterpressSavePreviewProbeInstalled) return;
  window.__gutterpressSavePreviewProbeInstalled = true;
  window.addEventListener('message', (event) => {
    const data = event.data;
    const probe = window.__gutterpressSavePreviewProbe;
    if (probe && data?.type === 'gutterpress:event' && data.name === 'renderingComplete' && data.detail?.hotReload === true) {
      probe.sequence++;
      probe.result = {
        saveToVisibleMs: performance.now() - probe.startedAt,
        hotReloadMs: Number(data.detail.hotReloadMs),
        sequence: probe.sequence,
      };
    }
  });
})()`);

const saveModifier = process.platform === "darwin" ? 4 : 2;
await send("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "s",
  code: "KeyS",
  windowsVirtualKeyCode: 83,
  modifiers: saveModifier,
});
await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "s",
  code: "KeyS",
  windowsVirtualKeyCode: 83,
  modifiers: saveModifier,
});

let sourceSaved = false;
for (let i = 0; i < 80; i++) {
  if (readFileSync(chapterPath, "utf8").includes(marker)) {
    sourceSaved = true;
    break;
  }
  await sleep(25);
}
if (!sourceSaved) fail("Ctrl+S did not write the CodeMirror edit to disk");

async function queryActivePreviewForMarker() {
  return evalJs(`new Promise((resolve) => {
  const frame = document.querySelector('.preview-pane > iframe');
  if (!frame?.contentWindow) return resolve({ hasMarker: false, error: 'preview frame missing' });
  const origin = new URL(frame.src).origin;
  const id = 900000000 + Math.floor(Math.random() * 1000000);
  const timeout = setTimeout(() => {
    window.removeEventListener('message', onMessage);
    resolve({ hasMarker: false, error: 'query timed out' });
  }, 10000);
  function onMessage(event) {
    const data = event.data;
    if (event.source !== frame.contentWindow || event.origin !== origin || data?.type !== 'gutterpress:reply' || data.id !== id) return;
    clearTimeout(timeout);
    window.removeEventListener('message', onMessage);
    const text = Array.isArray(data.result) ? data.result.map((row) => row.text || '').join(' ') : '';
    resolve({
      hasMarker: data.ok === true && text.includes(${JSON.stringify(marker)}),
      textLength: text.length,
      textEnd: text.slice(-500),
      error: data.error || null,
    });
  }
  window.addEventListener('message', onMessage);
  frame.contentWindow.postMessage({
    type: 'gutterpress:cmd', id, cmd: 'queryDom',
    args: [{ selector: 'body', fields: ['text'], limit: 1 }],
  }, origin);
})`);
}

let previewResult = null;
let previewMarkerResult = null;
let observedSequence = 0;
for (let i = 0; i < 1200; i++) {
  const candidate = await evalJs(`window.__gutterpressSavePreviewProbe?.result ?? null`);
  if (Number.isFinite(candidate?.saveToVisibleMs) && candidate.sequence > observedSequence) {
    observedSequence = candidate.sequence;
    previewMarkerResult = await queryActivePreviewForMarker();
    if (previewMarkerResult?.hasMarker) {
      previewResult = candidate;
      break;
    }
  }
  await sleep(25);
}
if (!Number.isFinite(previewResult?.saveToVisibleMs)) {
  if (observedSequence === 0) {
    fail("Ctrl+S wrote the source file but no atomic preview update arrived within 30 s");
  }
  fail(
    `the atomic preview updated ${observedSequence} time(s) without the saved source marker: ` +
    JSON.stringify(previewMarkerResult),
  );
}
if (!previewMarkerResult?.hasMarker) {
  fail(`the atomic preview update completed without the saved source marker: ${JSON.stringify(previewMarkerResult)}`);
}
const saveToVisibleMs = Math.round(previewResult.saveToVisibleMs);
const hotReloadMs = Math.round(previewResult.hotReloadMs);
const preShellMs = Math.max(0, saveToVisibleMs - hotReloadMs);
if (saveToVisibleMs > MAX_SAVE_TO_VISIBLE_MS) {
  fail(
    `Ctrl+S → visible preview took ${saveToVisibleMs}ms (limit ${MAX_SAVE_TO_VISIBLE_MS}ms; ` +
    `pre-shell ${preShellMs}ms, shell ${hotReloadMs}ms)`,
  );
}

// renderingComplete is not sufficient if its follow-up outline/lint work wedges
// the renderer. Let those tasks run, then prove the SPA, host route, toolbar,
// and preview bridge all still respond.
await sleep(1500);
let responsive;
try {
  responsive = await withTimeout(evalJs(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const button = document.querySelector('button[aria-label="Toggle markdown editor"]');
    if (!button) return { error: 'editor toggle missing' };
    const before = button.getAttribute('aria-pressed');
    button.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = button.getAttribute('aria-pressed');
    button.click();
    const status = await fetch('/api/status');
    return { toggled: before !== after, status: status.status };
  })()`), 5000, "post-render UI responsiveness");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (!responsive?.toggled || responsive.status !== 200) {
  fail(`the app stopped responding after renderingComplete: ${JSON.stringify(responsive)}`);
}
const latePreviewResult = await queryActivePreviewForMarker();
if (!latePreviewResult?.hasMarker) {
  fail(`the preview bridge stopped responding after renderingComplete: ${JSON.stringify(latePreviewResult)}`);
}

log(
  `PASS — Save enabled, Ctrl+S wrote source, preview updated in ${saveToVisibleMs}ms, and the app remained responsive ` +
  `(pre-shell ${preShellMs}ms, shell ${hotReloadMs}ms)`,
);
cleanup();
process.exit(0);
