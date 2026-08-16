#!/usr/bin/env node
/**
 * End-to-end proof that the Galley editor actually edits (ADR 0011).
 *
 * Other galley tests run the engine bundles against a synthetic page
 * (src/engine/galley/galley-mount.test.ts) or assert a unit contract. Nothing
 * proved the whole chain in the SHIPPED app: real keystrokes into the
 * paginated page -> ProseMirror doc -> chapter proposal over the bridge ->
 * commit engine -> bytes on disk.
 *
 * Frame layout (why there is exactly one extra CDP session):
 *   app://local            the SPA. Cross-origin from the preview, so the
 *                          preview is an out-of-process iframe with its own
 *                          CDP target and is absent from this frame tree.
 *     http://127.0.0.1:P/  the preview shell.
 *       /book.html         the book — SAME-ORIGIN with the shell, so it is
 *                          reachable as `contentWindow` from the shell.
 * Attach to the shell target and talk to the book through it. Input events
 * always go to the TOP page; the browser routes them to the right frame by
 * coordinate, which is what makes the typing real.
 *
 * Usage:
 *   node tests/integration/galley-editing.pw.mjs [exe-or-main-js] [fixture-dir]
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
const PORT = 9500 + Math.floor(Math.random() * 300);
const NEEDLE = "Alpha opening paragraph";
const TYPED = " GALLEYE2E";

const log = (m) => console.log(`[galley-e2e] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child = null, fakeHome = null, bookDir = null, cleaned = false;
const appLog = [];
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child?.kill(); } catch {} }
  for (const d of [fakeHome, bookDir]) { try { if (d) rmSync(d, { recursive: true, force: true }); } catch {} }
}
function fail(m) {
  console.error(`[galley-e2e] FAIL: ${m}`);
  console.error("[galley-e2e] app output:\n" + appLog.join("").split("\n").filter((l) => l.trim()).slice(-25).join("\n"));
  cleanup();
  process.exit(1);
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── fixture, with a byte-exact baseline of every chapter ─────────────────────
const [, , exeArg, fixtureArg] = process.argv;
const srcFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(srcFixture)) fail(`fixture not found: ${srcFixture}`);
bookDir = mkdtempSync(join(tmpdir(), "gutterpress-galley-e2e-"));
cpSync(srcFixture, bookDir, { recursive: true });
const chapters = readdirSync(bookDir).filter((f) => f.endsWith(".md"));
if (!chapters.length) fail("fixture has no .md chapters");
const baseline = new Map(chapters.map((f) => [f, readFileSync(join(bookDir, f), "utf8")]));
log(`fixture: ${bookDir} (${chapters.join(", ")})`);

// ── launch the built app ─────────────────────────────────────────────────────
const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`bun run build && bun run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-galley-e2e-home-"));
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: true, activeTab: "toc", width: 280 } }));
// Inline editing ships ON; state it so a future default flip fails loudly here
// instead of silently testing the read-only viewer.
writeFileSync(join(userDataDir, "app-settings.json"),
  JSON.stringify({ settingsSchemaVersion: 2, preview: { inlineEditing: true } }));
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, "--no-sandbox", `--user-data-dir=${userDataDir}`];
const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
child = spawn(
  useXvfb ? "xvfb-run" : electronBin,
  useXvfb ? ["-a", "-s", "-screen 0 1600x1000x24", electronBin, ...appArgv] : appArgv,
  {
    cwd: desktopDir, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, HOME: fakeHome,
      XDG_CONFIG_HOME: join(fakeHome, ".config"),
      XDG_CACHE_HOME: join(fakeHome, ".cache"),
      XDG_DATA_HOME: join(fakeHome, ".local", "share"),
      ELECTRON_DISABLE_GPU: "1",
    },
  },
);
const capture = (b) => { appLog.push(String(b)); if (appLog.length > 400) appLog.shift(); };
child.stdout.on("data", capture);
child.stderr.on("data", capture);

// ── minimal CDP session helper ───────────────────────────────────────────────
const WebSocketImpl = globalThis.WebSocket ?? require_("playwright-core/lib/utilsBundle").ws;
function session(wsUrl) {
  const sock = new WebSocketImpl(wsUrl);
  const waiting = new Map();
  let id = 0;
  sock.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const opened = new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  const call = (method, params = {}) =>
    new Promise((res) => { const i = ++id; waiting.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) fail(`eval threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
    return r.result?.result?.value;
  };
  return { opened, call, evaluate };
}
async function targetWs(pred, label, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find(pred);
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  fail(`${label} never appeared (${tries}s)`);
}
async function waitFor(fn, secs, label) {
  for (let i = 0; i < secs; i++) { if (await fn()) return; await sleep(1000); }
  fail(label);
}

const app = session(await targetWs((t) => t.type === "page" && String(t.url).startsWith("app://"), "app:// page", 60));
await app.opened;
await app.call("Page.bringToFront");

// ── SPA up, project open, welcome layer dismissed ────────────────────────────
await waitFor(() => app.evaluate(`!!document.querySelector('iframe')`), 90, "preview iframe never mounted");
await waitFor(() => app.evaluate(`!!(document.querySelector('.toc-item') || document.querySelector('.file-item'))`),
  120, "project never opened (no TOC/file items)");
// Auto-open leaves a welcome layer that makes the workspace inert — real mouse
// input would be swallowed by it.
await app.evaluate(`document.querySelector('button[aria-label="Close this screen"]')?.click(); true`);
await waitFor(() => app.evaluate(`!document.querySelector('.app-root[inert]')`), 20,
  "welcome layer never released the workspace");
log("SPA ready, project open");

// ── attach to the preview shell, reach the book through it ───────────────────
const previewSrc = await app.evaluate(`document.querySelector('iframe')?.getAttribute('src') ?? null`);
if (!previewSrc) fail("preview iframe has no src");
const shell = session(await targetWs((t) => String(t.url).startsWith(previewSrc), "preview shell target"));
await shell.opened;
const inBook = (body) => shell.evaluate(
  `(() => { const w = document.querySelector('iframe')?.contentWindow; if (!w || !w.document) return null; const d = w.document; ${body} })()`,
);
log(`attached to preview shell (${previewSrc})`);

// ── the galley must actually be EDITING, not read-only ───────────────────────
await waitFor(() => inBook(`return !!(w.GutterpressGalley && w.GutterpressGalley.isEditing());`), 120,
  "galley never reported isEditing() — inline editing did not take over the preview");
log("galley is editing");

// ── click into a real, laid-out paragraph ────────────────────────────────────
// The fragmenter keeps re-laying-out for a moment after the galley mounts, so
// a paragraph measured once can move before the click lands. Re-measure and
// retry rather than sleeping and hoping; the caret assertion stays strict.
const appIframe = await app.evaluate(
  `(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { left: r.left, top: r.top }; })()`);
let caret = null;
let x = 0, y = 0;
for (let attempt = 1; attempt <= 8 && !caret; attempt++) {
  const box = await inBook(
    `const p = [...d.querySelectorAll('p')].find(e => (e.textContent||'').includes(${JSON.stringify(NEEDLE)}));
     if (!p) return null;
     const r = p.getBoundingClientRect();
     if (!r.width || !r.height) return null;
     const cx = r.left + r.width / 2, cy = r.top + Math.min(8, r.height / 2);
     // Only aim at a point the paragraph itself actually owns — if viewer
     // chrome covers it, clicking there would select nothing.
     const hit = d.elementFromPoint(cx, cy);
     if (!(hit === p || p.contains(hit))) return null;
     return { cx, cy };`,
  );
  // The shell scales the book iframe to fit the pane, so book coordinates are
  // not screen coordinates.
  const shellIframe = (await shell.evaluate(
    `(() => {
       const f = document.querySelector('iframe');
       if (!f) return null;
       const r = f.getBoundingClientRect();
       const inner = f.contentWindow?.innerWidth || r.width;
       return { left: r.left, top: r.top, scale: r.width / inner };
     })()`)) ?? { left: 0, top: 0, scale: 1 };
  if (!box) { await sleep(1000); continue; }
  const k = shellIframe.scale || 1;
  x = Math.round(appIframe.left + shellIframe.left + box.cx * k);
  y = Math.round(appIframe.top + shellIframe.top + box.cy * k);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await app.call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: 1 });
  }
  await sleep(400);
  const got = await inBook(
    `const sel = w.getSelection();
     if (!sel || sel.rangeCount === 0) return null;
     const n = sel.anchorNode;
     const el = n && (n.nodeType === 1 ? n : n.parentElement);
     const p = el && el.closest && el.closest('p');
     return p ? { text: (p.textContent||'').slice(0, 40) } : null;`,
  );
  if (got && String(got.text).includes(NEEDLE.slice(0, 12))) caret = got;
  else if (attempt < 8) await sleep(1000);
}
if (!caret) {
  const at = await inBook(
    `const p = [...d.querySelectorAll('p')].find(e => (e.textContent||'').includes(${JSON.stringify(NEEDLE)}));
     if (!p) return { noParagraph: true };
     const r = p.getBoundingClientRect();
     const hit = d.elementFromPoint(r.left + r.width / 2, r.top + Math.min(8, r.height / 2));
     return { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
              hit: hit ? hit.tagName + '.' + String(hit.className || '') : null,
              editable: d.querySelector('.ProseMirror')?.getAttribute('contenteditable') ?? null };`,
  );
  console.error("[galley-e2e] hit-test inside book:", JSON.stringify(at));
  fail(`click at (${x}, ${y}) never placed a caret in the target paragraph after 8 attempts`);
}
log(`caret placed in the target paragraph`);
for (const type of ["keyDown", "keyUp"]) {
  await app.call("Input.dispatchKeyEvent", { type, key: "End", code: "End", windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 });
}

// ── type for real ────────────────────────────────────────────────────────────
for (const ch of TYPED) {
  await app.call("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch, key: ch });
  await app.call("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  await sleep(25);
}
log(`typed ${JSON.stringify(TYPED)}`);
const landed = await inBook(
  `const p = [...d.querySelectorAll('p')].find(e => (e.textContent||'').includes(${JSON.stringify(NEEDLE)}));
   return p ? (p.textContent||'').includes(${JSON.stringify(TYPED.trim())}) : false;`,
);
if (!landed) fail("keystrokes never reached the paginated page — it is not editable in the shipped app");
log("keystrokes landed in the page");

// ── the debounced save must reach disk ───────────────────────────────────────
let saved = null;
for (let i = 0; i < 60 && !saved; i++) {
  saved = chapters.find((f) => readFileSync(join(bookDir, f), "utf8").includes(TYPED.trim())) ?? null;
  if (!saved) await sleep(500);
}
if (!saved) fail(`typed text never reached disk in 30s (checked ${chapters.join(", ")})`);
if (saved !== "01-alpha.md") fail(`text landed in ${saved}, expected 01-alpha.md — wrong chapter targeted`);
log(`saved to ${saved}`);

// ── every other byte, in every chapter, is unchanged ─────────────────────────
for (const f of chapters) {
  if (f === saved) continue;
  if (readFileSync(join(bookDir, f), "utf8") !== baseline.get(f)) {
    fail(`untouched chapter ${f} was rewritten — byte preservation broken`);
  }
}
const before = baseline.get(saved);
const undone = readFileSync(join(bookDir, saved), "utf8").replace(TYPED, "");
if (undone !== before) {
  // TWO KNOWN NORMALIZATIONS, named here rather than silently tolerated. Any
  // difference beyond these two fails.
  //
  //  1. A run of 2+ blank lines between blocks collapses to one. Block bytes
  //     are preserved by node identity, but whitespace BETWEEN blocks belongs
  //     to no node, so prosemirror-markdown emits its own single separator.
  //     Semantically identical markdown — but it does mean saving one edit
  //     reflows the author's blank-line spacing elsewhere in the file.
  //  2. A missing final newline is added (serializeGalleyDoc guarantees one).
  //
  // Neither loses content. If either becomes unacceptable, fix the codec —
  // do not loosen this comparison.
  const collapseBlankRuns = (t) => t.replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
  const cb = collapseBlankRuns(before), cu = collapseBlankRuns(undone);
  if (cu !== cb) {
    const at = [...cu].findIndex((c, i) => c !== cb[i]);
    fail(`edited chapter changed beyond the typed text (collapsed offset ${at})\n` +
      `  baseline: ${JSON.stringify(cb.slice(Math.max(0, at - 80), at + 80))}\n` +
      `  actual:   ${JSON.stringify(cu.slice(Math.max(0, at - 80), at + 80))}`);
  }
  const lost = (before.match(/\n{3,}/g) || []).length;
  const addedNl = !before.endsWith("\n");
  log(`NOTE known normalizations applied: ${lost} blank-line run(s) collapsed` +
      (addedNl ? ", final newline added" : ""));
} else {
  log("byte-identical apart from the typed text");
}
log("only the typed text changed (modulo the noted blank-line normalization)");

log("PASS");
cleanup();
process.exit(0);
