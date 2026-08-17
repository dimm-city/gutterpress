#!/usr/bin/env node
/**
 * The RICH editing surface, end to end in the real desktop app.
 *
 * Every other integration suite pins `editor.mode: "source"`, because they
 * drive the CodeMirror surface by its selectors. That left the DEFAULT mode
 * with no end-to-end coverage at all — the app would have shipped with its
 * primary editor exercised only by unit tests and headless browser harnesses.
 * This is that coverage.
 *
 * What it proves, in the packaged app rather than a test double:
 *   1. Opening a markdown file in rich mode mounts the editor iframe.
 *   2. The surface is contenteditable and paginated to the BOOK's page size,
 *      using the book's own stylesheet.
 *   3. Typing reaches the buffer and lands in the file on disk, as markdown.
 *   4. The Rich/Markdown switch really swaps the surface, both ways, without
 *      losing the open file.
 *
 * Usage:
 *   node tests/integration/rich-editor.pw.mjs [<packaged-exe-path>] [fixture-dir]
 *
 * With no exe it runs `out/main/main.js` via the local electron binary, the
 * same fallback `editor-toggle-loads-module.pw.mjs` uses.
 *
 * Exit 0 on pass, 1 on fail.
 */
import { spawn } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEditorMode } from "./_editor-mode.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const PORT = 9700 + Math.floor(Math.random() * 150);

const log = (m) => console.log(`[rich-editor] ${m}`);
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
  console.error(`[rich-editor] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. fixture ───────────────────────────────────────────────────────────────
const [, , exeArg, fixtureArg] = process.argv;
const srcFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(srcFixture)) fail(`fixture not found: ${srcFixture}`);
bookDir = mkdtempSync(join(tmpdir(), "gutterpress-rich-"));
cpSync(srcFixture, bookDir, { recursive: true });
log(`fixture: ${bookDir}`);

// ── 2. launch ────────────────────────────────────────────────────────────────
const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) {
  fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
}
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;

fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-rich-home-"));
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
// The point of this suite: RICH, the product default, explicitly stated so a
// future change to the default cannot silently retarget it.
// `paneMode: "edit"` because the editor pane's own guard hides it on a narrow
// layout unless the edit pane is the active one — without it the toggle click
// is a silent no-op and this suite fails on a selector rather than on the
// editor.
pinEditorMode(userDataDir, "rich", { preview: { paneMode: "edit" } });
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: bookDir,
    leftPanel: { open: true, activeTab: "files", width: 280 },
    showLandingAtStartup: false,
  }),
);

const appArgv = [
  ...(isMainJs ? [target] : []),
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--no-sandbox",
];
const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
const cmd = useXvfb ? "xvfb-run" : electronBin;
const cmdArgs = useXvfb
  ? ["-a", "-s", "-screen 0 1600x1000x24", electronBin, ...appArgv]
  : appArgv;
log(`launching: ${cmd} ${cmdArgs.join(" ")}`);
child = spawn(cmd, cmdArgs, {
  cwd: desktopDir,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HOME: fakeHome, ELECTRON_DISABLE_GPU: "1" },
});
child.stdout.on("data", () => {});
child.stderr.on("data", () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 3. CDP attach ────────────────────────────────────────────────────────────
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    pageErrors.push(m.params?.exceptionDetails?.exception?.description
      ?? m.params?.exceptionDetails?.text ?? "unknown");
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
    pageErrors.push((m.params.args ?? []).map((a) => a.description ?? a.value).join(" "));
  }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send("Runtime.enable");
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    fail(`page eval threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  }
  return r.result?.result?.value;
}
async function waitFor(expression, label, seconds = 60, soft = false) {
  for (let i = 0; i < seconds; i++) {
    if (await evalJs(expression)) return true;
    await sleep(1000);
  }
  if (soft) return false;
  fail(`${label} (waited ${seconds}s)`);
}
await send("Page.bringToFront");

await waitFor(
  `!!document.querySelector('button[aria-label="Toggle markdown editor"]')`,
  "SPA never became interactive",
);
log("SPA ready");

// ── 4. open the editor on a chapter ──────────────────────────────────────────
// Wait for the project to actually be open first. The toggle is rendered
// before the folder finishes loading, and clicking it early is a no-op — the
// pane's own guard requires a loaded folder project.
await waitFor(
  `!!document.querySelector('.file-item.active .file-name')`,
  "the project never auto-opened (no active file)",
);
log("project open");

// Open the editor. Exactly ONE click — this is a toggle, and a retry loop
// would close it again.
await evalJs(`document.querySelector('button[aria-label="Toggle markdown editor"]').click()`);

// Opening the editor in rich mode offers the one-time tidy, because saving
// rich rewrites the file canonically. That is the real author flow, so drive
// it: take the offer, which is also the state the rest of this suite needs
// (source-offset edits require the file on disk to be canonical).
if (await waitFor(`!!document.querySelector('.nz-dialog')`, "", 15, true)) {
  log("normalize offered; accepting");
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('.nz-actions button')]
      .find(x => /tidy the markdown/i.test(x.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await waitFor(`!document.querySelector('.nz-dialog')`, "the normalize dialog never closed", 30);
  log("project tidied");
}

// Applying the tidy rewrites files, which the folder watch sees as a project
// change — and a project reset closes the editor pane. Reopen if that happened.
if (!(await waitFor(`!!document.querySelector('.editor-pane')`, "", 8, true))) {
  log("editor closed by the post-tidy project refresh; reopening");
  await evalJs(`document.querySelector('button[aria-label="Toggle markdown editor"]').click()`);
}
if (!(await waitFor(`!!document.querySelector('.editor-pane')`, "", 20, true))) {
  // Page errors are the signal that matters here: a thrown error inside the
  // pane's subtree removes the whole thing, and the DOM alone just looks
  // "closed". This is how a temporal-dead-zone `isMd` reference — invisible to
  // `tsc`, which does not read .svelte files — was found.
  console.log("[rich-editor] PAGE ERRORS:", JSON.stringify(pageErrors.slice(0, 4), null, 2));
  fail("the editor pane never opened");
}
log("editor pane open");
const mounted = await waitFor(
  `!!document.querySelector('iframe.rich-editor')`,
  "the rich editor iframe never mounted", 25, true,
);
const diag = await evalJs(`JSON.stringify({
  editorPane: !!document.querySelector('.editor-pane'),
  modeSwitch: !!document.querySelector('.editor-mode-switch'),
  richFrame: !!document.querySelector('iframe.rich-editor'),
  cm: !!document.querySelector('.cm-editor'),
  activeFile: document.querySelector('.file-item.active .file-name')?.textContent?.trim() ?? null,
  fileItems: [...document.querySelectorAll('.file-item .file-name')].map(e=>e.textContent.trim()).slice(0,5),
  modeNote: document.querySelector('.editor-mode-note')?.textContent?.trim() ?? null,
  loading: document.body.innerText.includes('Loading editor'),
})`);
if (!mounted) {
  console.log("[rich-editor] DIAG:", diag);
  fail("rich editor iframe never mounted");
}
log("rich editor mounted");

// ── 5. it is a real, paginated, book-styled editing surface ──────────────────
const surface = await evalJs(`(() => {
  const frame = document.querySelector('iframe.rich-editor');
  const doc = frame.contentDocument;
  const flow = doc.querySelector('.gp-editor-page-flow');
  if (!flow) return JSON.stringify({ ok: false, why: 'no page flow' });
  const cs = doc.defaultView.getComputedStyle(flow);
  return JSON.stringify({
    ok: true,
    editable: flow.getAttribute('contenteditable'),
    columnHeight: cs.columnHeight,
    columnWrap: cs.columnWrap,
    blocks: flow.children.length,
    chars: (flow.textContent || '').length,
  });
})()`);
const s = JSON.parse(surface);
if (!s.ok) fail(`editing surface not present: ${s.why}`);
if (s.editable !== "true") fail(`surface is not editable (contenteditable=${s.editable})`);
if (!/^\d+(\.\d+)?px$/.test(s.columnHeight || "")) {
  fail(`surface is not paginated to a page height (column-height=${s.columnHeight})`);
}
if (s.columnWrap !== "wrap") fail(`pages do not stack (column-wrap=${s.columnWrap})`);
if (!s.blocks || !s.chars) fail(`surface rendered no content (${surface})`);
log(`surface: ${s.blocks} blocks, ${s.chars} chars, page height ${s.columnHeight}`);

// ── 6. typing reaches the file on disk, as markdown ──────────────────────────
const MARKER = "RICH-E2E-MARKER";
const openFile = await evalJs(
  `document.querySelector('.file-item.active .file-name')?.textContent?.trim() ?? null`,
);
if (!openFile) fail("no active file in the file tree");
const openPath = join(bookDir, openFile);
const before = readFileSync(openPath, "utf8");
log(`typing into ${openFile}`);

await evalJs(`(() => {
  const doc = document.querySelector('iframe.rich-editor').contentDocument;
  const flow = doc.querySelector('.gp-editor-page-flow');
  const p = flow.querySelector('p') || flow.firstElementChild;
  const sel = doc.getSelection();
  const range = doc.createRange();
  range.setStart(p.firstChild || p, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  flow.focus();
  return true;
})()`);
// Real key events, so this goes through ProseMirror's own input handling
// rather than a synthetic transaction.
for (const ch of MARKER) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
}

let saved = before;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  saved = readFileSync(openPath, "utf8");
  if (saved.includes(MARKER)) break;
  await sleep(250);
}
if (!saved.includes(MARKER)) {
  fail(`typed text never reached ${openFile} on disk within 20s`);
}
if (saved === before) fail("file unchanged");
log("typed text saved to disk as markdown");

// ── 7. the mode switch really swaps the surface, both ways ───────────────────
await waitFor(`!!document.querySelector('.editor-mode-switch')`, "no mode switch rendered");
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.editor-mode-switch button')]
    .find(x => /markdown/i.test(x.textContent || ''));
  b.click(); return true;
})()`);
await waitFor(`!!document.querySelector('.cm-editor')`, "switching to Markdown did not mount CodeMirror");
if (await evalJs(`!!document.querySelector('iframe.rich-editor')`)) {
  fail("the rich iframe survived the switch to Markdown — it must be unmounted, not hidden");
}
log("switched to Markdown");

// The open file must still be there — a mode switch is a view change, never a
// file change.
const stillOpen = await evalJs(
  `document.querySelector('.cm-content')?.textContent?.includes(${JSON.stringify(MARKER)}) ?? false`,
);
if (!stillOpen) fail("the open file's content did not survive the switch to Markdown");

await evalJs(`(() => {
  const b = [...document.querySelectorAll('.editor-mode-switch button')]
    .find(x => /rich/i.test(x.textContent || ''));
  b.click(); return true;
})()`);
await waitFor(`!!document.querySelector('iframe.rich-editor')`, "switching back to Rich did not remount");
const backChars = await evalJs(`(() => {
  const doc = document.querySelector('iframe.rich-editor').contentDocument;
  const flow = doc.querySelector('.gp-editor-page-flow');
  return flow && flow.textContent.includes(${JSON.stringify(MARKER)});
})()`);
if (!backChars) fail("the open file's content did not survive the switch back to Rich");
log("switched back to Rich, content intact");

log("PASS");
cleanup();
process.exit(0);
