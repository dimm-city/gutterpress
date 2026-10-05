#!/usr/bin/env node
/**
 * Problems panel (#28) end-to-end check, driven over raw CDP (launch pattern
 * xvfb when headless, throwaway HOME,
 * --remote-debugging-port).
 *
 * What it verifies against the BUILT app (out/main/main.js or a packaged exe):
 *   1. Opens a temp COPY of the multichapter fixture seeded with two
 *      deliberate lint findings: a broken local image ref (error,
 *      source.links.local-refs) and a `filter:` declaration in a CSS file
 *      (warning, source.stylelint / printsafe risky-props).
 *   2. After the preview renders, the toolbar Problems button shows badge "2".
 *   3. Opening the panel lists both findings (file, line, message), in a row of
 *      its own between the workspace and the status bar (never over either, #307).
 *      Keyboard: opening moves focus into the list, Escape closes it and puts
 *      focus back on the toggle, Enter on the toggle re-opens it (#307).
 *   4. Clicking the broken-ref entry opens the editor on 01-alpha.md with the
 *      offending line scrolled into view.
 *   5. At 700px window width the toolbar still has zero pairwise overlaps
 *      (getBoundingClientRect audit of every visible toolbar control), and the
 *      status bar still shows its save-state text and the Problems badge (#316),
 *      and the left-panel drawer stops at the status bar's top edge (#307).
 *
 * Screenshots: <os tmpdir>/problems-panel-{wide,narrow}.png.
 * Prints the audit JSON for the report.
 *
 * Usage: node tests/integration/problems-panel.pw.mjs [exe-or-main-js] [fixture-dir]
 * Exit 0 on pass, 1 on fail.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, existsSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const PORT = 9800 + Math.floor(Math.random() * 150);

const log = (m) => console.log(`[problems-panel] ${m}`);
let child = null;
let fakeHome = null;
let bookDir = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  // POSIX: signal the whole detached process group. Windows: no process
  // groups / negative PIDs — kill the direct child instead.
  // SIGKILL, not SIGTERM: Electron does not reliably die on SIGTERM — Chromium
  // begins a graceful shutdown that outlives this script, so the app survives the
  // run. Measured on CI, a 10-run leg left exactly 10 orphan Electrons, and every
  // leaked instance kept competing for the runner (see the diagnosis in
  // editor-opens-with-content.pw.mjs's header). SIGKILL cannot be caught, so the
  // process group actually ends.
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child?.kill("SIGKILL"); } catch {} }
  // Throwaway dirs created BY THIS SCRIPT via mkdtemp — safe to remove.
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  try { if (bookDir) rmSync(bookDir, { recursive: true, force: true }); } catch {}
}
const fail = (m) => {
  console.error(`[problems-panel] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. fixture copy with deliberate lint findings ───────────────────────────
const [, , exeArg, fixtureArg] = process.argv;
const srcFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(srcFixture)) fail(`fixture not found: ${srcFixture}`);
 bookDir = mkdtempSync(join(tmpdir(), "gutterpress-problems-fixture-"));
cpSync(srcFixture, bookDir, { recursive: true });
// Error: local image reference that does not exist on disk (source.links.local-refs).
appendFileSync(join(bookDir, "01-alpha.md"), "\n![Missing art](./missing-art.png)\n");
// Warning: risky print property (source.stylelint → printsafe/no-risky-print-effects).
// The CSS lint runs over the manifest's `styles` list, so add extra.css to the
// EXISTING styles array — appending a new `styles:` key would produce a
// duplicate YAML key which breaks manifest parsing.
writeFileSync(join(bookDir, "extra.css"), "h1 {\n  filter: blur(1px);\n}\n");
const manifestPath = join(bookDir, "manifest.yaml");
const manifest = readFileSync(manifestPath, "utf8");
writeFileSync(manifestPath, manifest.replace(/^(styles:.*\n(?:  - .*\n)*)/m, "$1  - extra.css\n"));
log(`seeded fixture: ${bookDir}`);

// ── 2. launch the built app ─────────────────────────────────────────────────
const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, "--no-sandbox"];

 fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-problems-home-"));
// xvfb is a Linux-only headless fallback; Windows/macOS never have DISPLAY.
const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
const cmd = useXvfb ? "xvfb-run" : electronBin;
const cmdArgs = useXvfb ? ["-a", "-s", "-screen 0 1600x1000x24", electronBin, ...appArgv] : appArgv;
log(`launching: ${cmd} ${cmdArgs.join(" ")} (HOME=${fakeHome}${useXvfb ? ", via xvfb-run" : ""})`);
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
  fail("CDP endpoint / app:// page target never appeared (60s)");
}
// Node < 22 has no global WebSocket (the CI runner's setup-node is 20) — fall
// back to playwright-core's bundled `ws` client, which mirrors the browser
// onopen/onmessage/onerror surface.
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
async function screenshot(file) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  log(`screenshot: ${file}`);
}
// A real key press through CDP (not a synthetic DOM event), so a focused
// button activates on Enter the way it does for a person at the keyboard.
const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
};
async function press(name) {
  const { text, ...k } = KEYS[name];
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", text, ...k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}
await send("Page.bringToFront");

// ── 4. open the seeded fixture via the left panel Books tab ──────────────────
let spaReady = false;
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!document.querySelector('button[aria-label="Toggle left panel"]')`)) { spaReady = true; break; }
  await sleep(1000);
}
if (!spaReady) fail("SPA never became interactive (left panel toggle not found in 60s)");

// Wait for the Books tab to auto-open (it opens when no book is loaded)
let panelReady = false;
for (let i = 0; i < 20; i++) {
  const hasInput = await evalJs(`!!document.querySelector('.projects-body .location-input')`);
  if (hasInput) { panelReady = true; break; }
  await sleep(500);
}
if (!panelReady) {
  await evalJs(`document.querySelector('button[aria-label="Toggle left panel"]').click(); true`);
  await sleep(500);
  await evalJs(`(() => {
    const tabs = [...document.querySelectorAll('.panel-tab')];
    const t = tabs.find(b => b.textContent.trim().toUpperCase().includes('BOOKS'));
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(300);
}

await evalJs(`(async () => {
  const inp = document.querySelector('.projects-body .location-input');
  if (!inp) return false;
  inp.focus();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(inp, ${JSON.stringify(bookDir)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
log("books panel driven; waiting for book to open…");

// Wait for the Contents outline to populate — same signal the editor-dropdown-sync
// test uses (120s). This fires once markdown-it has parsed the files and the
// outline is built, long before full viewer layout completes.
let projectOpen = false;
for (let i = 0; i < 120; i++) {
  const open = await evalJs(`!!(document.querySelector('.toc-item') || document.querySelector('.file-item'))`);
  if (open) { projectOpen = true; break; }
  await sleep(1000);
}
if (!projectOpen) fail("project never opened — no TOC items or file items appeared (120s)");
log("project opened");

// ── 5. counts on the problems strip ──────────────────────────────────────────
// The strip sits in the status bar at the bottom of the screen (not in the
// navbar) and shows error/warning counts without a dedicated badge element. It
// is a button only while there is something to list (#307) — a clean project
// shows the same badge, inert — so it appears with the counts.
//
// Those counts are downstream of the FIRST FULL RENDER, not of the project-open
// gate above: the app calls refreshProblems() from its renderingComplete
// handler, while that gate fires as soon as the sources are parsed (measured on
// a green CI run: ~9s after "project opened"). Budget it like the project-open
// gate above, since it waits on the same pipeline, and report what the strip
// actually showed on the way out: a render that never finished, a lint that
// errored, and a lint that found nothing must be distinguishable, and only one
// of the three is fixed by waiting longer.
const readStrip = () => evalJs(`(() => {
  const strip = document.querySelector('.toggle-strip');
  if (!strip) return { strip: false };
  return {
    strip: true,
    errs: strip.querySelector('.error-count')?.textContent?.trim() ?? null,
    warns: strip.querySelector('.warning-count')?.textContent?.trim() ?? null,
    status: /couldn't check/.test(strip.getAttribute('aria-label') ?? '') ? "Couldn't check" : null,
    stillRendering: !!document.querySelector('.loading-overlay'),
  };
})()`);
const hasCounts = (s) => !!(s?.errs || s?.warns);
let stripCounts = await readStrip();
const stripDeadline = Date.now() + 120000;
// "Couldn't check" is lint reporting its own failure: the counts are never
// coming, so sitting out the budget would only delay the same verdict.
while (!hasCounts(stripCounts) && stripCounts?.status !== "Couldn't check" && Date.now() < stripDeadline) {
  await sleep(500);
  stripCounts = await readStrip();
}
if (!hasCounts(stripCounts)) {
  fail(`problems strip never showed error/warning counts — last strip state ${JSON.stringify(stripCounts)}`);
}
log(`strip counts: ${JSON.stringify(stripCounts)}`);

// ── 6. open the panel; verify both findings render ───────────────────────────
await evalJs(`document.querySelector('.toggle-strip').click(); true`);
await sleep(500);
const panel = await evalJs(`(() => {
  const panel = document.querySelector('.problems-panel');
  if (!panel) return null;
  return {
    headerCounts: panel.querySelector('.panel-counts')?.innerText ?? "",
    groups: [...panel.querySelectorAll('.group')].map((g) => ({
      file: g.querySelector('.group-file-name')?.textContent,
      entries: [...g.querySelectorAll('.entry')].map((e) => ({
        message: e.querySelector('.entry-message')?.textContent,
        source: e.querySelector('.entry-source')?.textContent,
        line: e.querySelector('.entry-line')?.textContent,
        severity: e.querySelector('.entry-severity')?.className ?? "",
      })),
    })),
  };
})()`);
if (!panel) fail("problems panel did not open");
log(`panel contents: ${JSON.stringify(panel, null, 2)}`);
const allEntries = panel.groups.flatMap((g) => g.entries.map((e) => ({ ...e, file: g.file })));
const brokenRef = allEntries.find((e) => (e.message ?? "").includes("missing-art.png"));
if (!brokenRef) fail("broken local-ref finding not listed");
if (brokenRef.file !== "01-alpha.md") fail(`broken-ref grouped under ${brokenRef.file}, expected 01-alpha.md`);
// A missing IMAGE is a warning, not an error, and deliberately so: the
// asset planner substitutes a loud magenta placeholder, so the build still
// produces a book (checks/source/local-refs.ts — `kind === "image" ?
// "warning" : "error"`). A missing link has no such fallback and stays an
// error. This assertion read `sev-error` and had been failing ever since,
// unnoticed because no workflow ran this drive.
if (!/warning/.test(brokenRef.severity)) fail(`broken-ref severity class ${brokenRef.severity}, expected sev-warning`);
const risky = allEntries.find((e) => (e.message ?? "").includes("filter"));
if (!risky) fail("risky print-property (filter) finding not listed");
if (risky.file !== "extra.css") fail(`risky finding grouped under ${risky.file}, expected extra.css`);
if (!/warning/.test(risky.severity)) fail(`risky severity class ${risky.severity}, expected sev-warning`);
log("both seeded findings listed with correct file/severity");
// #307: the list is a row of its own between the workspace and the status bar,
// not an absolutely-positioned overlay covering the bottom of the left panel
// (hiding its buttons) and of the editor/preview.
const rows = await evalJs(`(() => {
  const body = document.querySelector('.problems-panel .panel-body').getBoundingClientRect();
  return {
    bodyTop: body.top,
    bodyBottom: body.bottom,
    workspaceBottom: document.querySelector('.left-panel-region').getBoundingClientRect().bottom,
    barTop: document.querySelector('.status-bar').getBoundingClientRect().top,
  };
})()`);
if (rows.bodyTop < rows.workspaceBottom - 1) {
  fail(`problems list overlaps the workspace: list top ${rows.bodyTop} < workspace bottom ${rows.workspaceBottom}`);
}
if (rows.bodyBottom > rows.barTop + 1) {
  fail(`problems list overlaps the status bar: list bottom ${rows.bodyBottom} > bar top ${rows.barTop}`);
}
log(`list sits between workspace and bar: ${JSON.stringify(rows)}`);
// #307 keyboard access: the list comes BEFORE the bar in the DOM, so a keyboard
// user who opens it from the toggle could not Tab into it. Opening therefore
// moves focus into the list, and Escape from inside closes it and hands focus
// back to the toggle (the way the editor toolbar's popups behave).
const focusState = () => evalJs(`(() => {
  const toggle = document.querySelector('.toggle-strip');
  const list = document.getElementById('problems-body');
  return {
    expanded: toggle?.getAttribute('aria-expanded') ?? null,
    inList: !!list && list.contains(document.activeElement),
    onToggle: !!toggle && document.activeElement === toggle,
    active: (document.activeElement?.className ?? '').toString().slice(0, 60),
  };
})()`);
let keyboard = await focusState();
// The click that opened the list above must already have put focus inside it.
if (keyboard.expanded !== "true" || !keyboard.inList) {
  fail(`opening the list did not move focus into it: ${JSON.stringify(keyboard)}`);
}
await press("Escape");
await sleep(300);
keyboard = await focusState();
if (keyboard.expanded !== "false" || !keyboard.onToggle) {
  fail(`Escape did not close the list and return focus to the toggle: ${JSON.stringify(keyboard)}`);
}
await press("Enter"); // focus is on the toggle: re-open it the way a keyboard user does
await sleep(500);
keyboard = await focusState();
if (keyboard.expanded !== "true" || !keyboard.inList) {
  fail(`Enter on the toggle did not open the list with focus inside: ${JSON.stringify(keyboard)}`);
}
log("keyboard: opening puts focus in the list; Escape closes it back to the toggle");
await screenshot(join(tmpdir(), "problems-panel-wide.png"));

// ── 7. click the broken-ref entry → editor opens 01-alpha.md at the line ────
await evalJs(`(() => {
  const entry = [...document.querySelectorAll('.problems-panel .entry')]
    .find((e) => e.textContent.includes('missing-art.png'));
  entry.click();
  return true;
})()`);
let editorState = null;
for (let i = 0; i < 30; i++) {
  editorState = await evalJs(`(() => {
    const cm = document.querySelector('.cm-editor');
    if (!cm) return null;
    const selected = document.querySelector('.file-tree [aria-current="true"]')?.textContent?.trim() ?? null;
    const lineVisible = [...cm.querySelectorAll('.cm-line')].some((l) => l.textContent.includes('missing-art'));
    return { selected, lineVisible };
  })()`);
  if (editorState?.lineVisible) break;
  await sleep(1000);
}
if (!editorState) fail("editor never opened after clicking the problem entry");
if (!(editorState.selected ?? "").includes("01-alpha.md")) {
  fail(`editor opened the wrong file: ${JSON.stringify(editorState.selected)}`);
}
if (!editorState.lineVisible) fail("offending line not scrolled into view in the editor");
log(`click-through OK: editor on ${editorState.selected}, line visible`);

// Close the problems panel before doing toolbar audit (panel overlays at 700px)
await evalJs(`(() => {
  const strip = document.querySelector('.toggle-strip[aria-expanded="true"]');
  if (strip) strip.click();
  return true;
})()`);
await sleep(300);

// ── 8. 700px toolbar overlap audit ───────────────────────────────────────────
// Close any open dropdown menus before auditing so menu panel items don't
// contribute false overlap readings against each other.
await evalJs(`(() => {
  document.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
  return true;
})()`);
await sleep(200);
// Emulate a 700px-wide layout viewport — the toolbar uses container queries
// keyed to its own inline size, which tracks the layout viewport width here.
await send("Emulation.setDeviceMetricsOverride", {
  width: 700,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(1500);
const audit = await evalJs(`(() => {
  const els = [...document.querySelectorAll('.toolbar button, .toolbar select, .toolbar summary, .toolbar .doc-title, .toolbar .path')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // Exclude elements inside open menu panels (dropdown items overlap by design)
      if (el.closest('.menu-panel')) return false;
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    });
  const rects = els.map((el) => ({
    label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim()).slice(0, 40),
    rect: (({ left, right, top, bottom, width }) => ({ left, right, top, bottom, width }))(el.getBoundingClientRect()),
  }));
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].rect, b = rects[j].rect;
      // Skip containment (menu summary inside details, nested groups).
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1) overlaps.push({ a: rects[i].label, b: rects[j].label, x: +x.toFixed(1), y: +y.toFixed(1) });
    }
  }
  const tb = document.querySelector('.toolbar').getBoundingClientRect();
  const overflow = rects.filter((r) => r.rect.right > tb.right + 1 || r.rect.left < tb.left - 1).map((r) => r.label);
  return { viewport: window.innerWidth, controls: rects.length, overlaps, overflow, rects };
})()`);
console.log(`[problems-panel] 700px toolbar audit: ${JSON.stringify({ viewport: audit.viewport, controls: audit.controls, overlaps: audit.overlaps, overflow: audit.overflow }, null, 2)}`);
console.log(`[problems-panel] 700px rects: ${JSON.stringify(audit.rects)}`);
if (audit.overlaps.length > 0) fail(`toolbar overlaps at 700px: ${JSON.stringify(audit.overlaps)}`);
if (audit.overflow.length > 0) fail(`toolbar controls overflow at 700px: ${JSON.stringify(audit.overflow)}`);
await screenshot(join(tmpdir(), "problems-panel-narrow.png"));

// ── 9. #316: the status bar keeps its words at 700px ─────────────────────────
// "Edits saved" must not collapse to a bare icon below 820px: the save text
// stays at every width; the Problems control is a compact badge (icon + count,
// no text label) with an accessible name that carries the breakdown.
const bar = await evalJs(`(() => {
  const shown = (sel) => {
    const el = document.querySelector(sel);
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  };
  return {
    saveText: document.querySelector('.save-text')?.textContent?.trim() ?? null,
    saveTextShown: shown('.save-text'),
    stripShown: shown('.toggle-strip'),
    stripCountShown: shown('.toggle-strip .error-count, .toggle-strip .warning-count'),
    stripHasText: /problems/i.test(document.querySelector('.toggle-strip')?.textContent ?? ''),
    stripLabel: document.querySelector('.toggle-strip')?.getAttribute('aria-label') ?? null,
  };
})()`);
console.log(`[problems-panel] 700px status bar: ${JSON.stringify(bar)}`);
if (!bar.saveTextShown || !bar.saveText) fail(`save-state text is not visible at 700px: ${JSON.stringify(bar)}`);
if (!bar.stripShown || !bar.stripCountShown) fail(`Problems badge (icon + count) is not visible at 700px: ${JSON.stringify(bar)}`);
if (bar.stripHasText) fail(`Problems badge should carry no visible text label: ${JSON.stringify(bar)}`);
if (!/^Problems: .*(error|warning)/.test(bar.stripLabel ?? "")) fail(`Problems badge accessible name is wrong: ${JSON.stringify(bar)}`);

// ── 10. #307: at 700px the left-panel drawer overlays the workspace but stops
// at the status bar's top edge — viewport-fixed with bottom:0 it would run
// underneath the bar and hide its own footer buttons (New book).
await evalJs(`(() => {
  if (!document.querySelector('.left-panel.open')) {
    document.querySelector('button[aria-label="Toggle left panel"]').click();
  }
  return true;
})()`);
await sleep(600);
const drawer = await evalJs(`(() => {
  const panel = document.querySelector('.left-panel.open');
  if (!panel) return null;
  return {
    bottom: panel.getBoundingClientRect().bottom,
    barTop: document.querySelector('.status-bar').getBoundingClientRect().top,
  };
})()`);
if (!drawer) fail("left panel did not open at 700px");
console.log(`[problems-panel] 700px drawer: ${JSON.stringify(drawer)}`);
if (Math.abs(drawer.bottom - drawer.barTop) > 1) {
  fail(`left-panel drawer does not stop at the status bar's top edge: ${JSON.stringify(drawer)}`);
}

log("PASS: badge, panel contents, click-through navigation, keyboard focus, 700px toolbar audit, status-bar text and drawer edge all verified");
cleanup();
process.exit(0);
