#!/usr/bin/env node
/**
 * Drive for Block properties and `.class` autocomplete, in the built app.
 *
 * The book is tests/integration/fixtures/block-props: one chapter with a
 * `@card … @end-card` block from a tiny LOCAL plugin (`plugins/house`) whose
 * component catalog documents `.hs-tight` as a modifier. That is the point of
 * the drive: the dialog and the completion list must offer a plugin's classes
 * from its own catalog, with nothing about any particular plugin built in.
 *
 *   1. Alt+Enter on the `@card` line opens Block properties. Core's keep-together
 *      is offered, the plugin's modifier is offered under the plugin's name, a
 *      retired catalog entry is not. Turning on keep-together and break-before
 *      and wrapping the content in two columns writes EXACTLY the expected text
 *      to the chapter file: one class appended, the rest of the marker line kept.
 *   2. The same dialog from the preview: right-click the card (its own box, not a
 *      paragraph in it), choose Block properties…, and turn the three back off.
 *      The file returns to the original byte for byte.
 *   3. Typing `.` after a marker word, and inside `{…}` on a heading and an image,
 *      lists core's gp-* and the plugin's classes with descriptions; Tab and
 *      Enter accept.
 *
 * Usage:
 *   node tests/integration/block-properties.pw.mjs [exe-or-main-js]
 * Exit 0 on pass, 1 on fail. Same harness and cleanup as
 * editor-opens-with-content.pw.mjs (CDP over Electron under xvfb, SIGKILL on exit).
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const PORT = 9300 + Math.floor(Math.random() * 250);

const log = (m) => console.log(`[block-props] ${m}`);
let child = null;
let fakeHome = null;
let bookDir = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  // SIGKILL, not SIGTERM — see editor-opens-with-content.pw.mjs.
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child?.kill("SIGKILL"); } catch {} }
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  try { if (bookDir) rmSync(bookDir, { recursive: true, force: true }); } catch {}
}
const fail = (m) => {
  console.error(`[block-props] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. fixture copy + launch ────────────────────────────────────────────────
const [, , exeArg] = process.argv;
const srcFixture = join(here, "fixtures", "block-props");
bookDir = mkdtempSync(join(tmpdir(), "gutterpress-blockprops-"));
cpSync(srcFixture, bookDir, { recursive: true });
const chapterFile = join(bookDir, "01-chapter.md");
const ORIGINAL = readFileSync(chapterFile, "utf8");

const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, "--no-sandbox"];

fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-blockprops-home-"));
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: true, activeTab: "toc", width: 260 } }),
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

// ── 2. CDP attach ───────────────────────────────────────────────────────────
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
const WebSocketImpl = globalThis.WebSocket ?? require_("playwright-core/lib/utilsBundle").ws;
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
async function waitFor(expr, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evalJs(expr)) return true;
    await sleep(300);
  }
  if (label) fail(`${label} (waited ${ms}ms for: ${expr})`);
  return false;
}
async function pollValue(expr, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await evalJs(expr);
    if (v != null && v !== false) return v;
    await sleep(400);
  }
  return null;
}
// Checks RECORD rather than abort, so one run shows every defect still present.
const failures = [];
const check = (ok, msg, extra) => {
  if (ok) log(`ok   — ${msg}`);
  else {
    failures.push(msg);
    console.error(`[block-props] FAIL — ${msg}${extra === undefined ? "" : `\n    ${JSON.stringify(extra)}`}`);
  }
  return ok;
};

// Real key events. Punctuation gets no virtual-key code of its own ("." as 46 is Delete).
async function key(k, { text, modifiers = 0, vk } = {}) {
  const base = {
    key: k,
    code: k,
    modifiers,
    windowsVirtualKeyCode: vk ?? (/^[A-Za-z0-9]$/.test(k) ? k.toUpperCase().charCodeAt(0) : 0),
  };
  await send("Input.dispatchKeyEvent", { type: text !== undefined ? "keyDown" : "rawKeyDown", ...base, ...(text !== undefined ? { text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function type(s) {
  for (const ch of s) {
    if (ch === "\n") await key("Enter", { text: "\r", vk: 13 });
    else await key(ch, { text: ch });
    await sleep(25);
  }
}
const ALT = 1;
const CTRL = 2;

await send("Page.bringToFront");

// ── 3. SPA + book ready ─────────────────────────────────────────────────────
await waitFor(`!!document.querySelector('button[aria-label="Edit"]')`, 60000, "SPA never became interactive");
await waitFor(`!!(document.querySelector('.toc-item') || document.querySelector('.file-item'))`, 120000, "project never opened");
await evalJs(`document.querySelector('button[aria-label="Close this screen"]')?.click(); true`);
for (let i = 0; i < 20; i++) {
  if (!(await evalJs(`!!document.querySelector('.app-root[inert]')`))) break;
  await sleep(50);
}
await waitFor(`!!document.querySelector('.cm-editor')`, 40000, "CONTROL: the editor never mounted");
await waitFor(`(document.querySelector('.cm-content')?.textContent ?? '').includes('House Rules')`, 20000, "CONTROL: the editor never showed the chapter");
await evalJs(`(() => {
  let id = 700000;
  window.__ask = (cmd, args) => new Promise((res) => {
    const f = document.querySelector('iframe');
    if (!f) return res(null);
    const myId = ++id;
    const h = (e) => {
      if (e.data?.type === 'gutterpress:reply' && e.data.id === myId) {
        window.removeEventListener('message', h); res(e.data.result);
      }
    };
    window.addEventListener('message', h);
    f.contentWindow.postMessage({ type: 'gutterpress:cmd', id: myId, cmd, args }, '*');
    setTimeout(() => { window.removeEventListener('message', h); res(null); }, 4000);
  });
  return true;
})()`);
await waitFor(
  `(async () => !document.querySelector('.region.overlay .layer') && (await window.__ask('getTotalPages', [])) > 0)()`,
  90000,
  "CONTROL: the render never settled in 90s",
);
log("book open, rendered");

const file = () => readFileSync(chapterFile, "utf8");
async function waitFile(expected, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (file() === expected) return true;
    await sleep(300);
  }
  return false;
}
const settled = () =>
  waitFor(
    `!document.querySelector('.region.overlay .layer') && !document.body.innerText.includes('Unsaved changes') && !document.body.innerText.includes('Saving…')`,
    40000,
    "CONTROL: the book never settled after an edit",
  );
const items = () => evalJs(`[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => li.textContent)`);
const lastLine = () => evalJs(`[...document.querySelectorAll('.cm-line')].map(l => l.textContent).slice(-1)[0]`);
const dialog = () =>
  evalJs(`(() => {
    const d = document.querySelector('.block-properties');
    if (!d) return null;
    return {
      title: d.querySelector('h2')?.textContent.replace(/\\s+/g, ' ').trim(),
      checks: [...d.querySelectorAll('label.check input')].map((i) => ({ name: i.name, checked: i.checked, group: i.closest('fieldset')?.querySelector('legend')?.textContent.trim() })),
      columns: d.querySelector('select[name="columns"]')?.value ?? null,
      columnsDisabled: d.querySelector('select[name="columns"]')?.disabled ?? null,
    };
  })()`);
const setCheck = (name, on) =>
  evalJs(`(() => { const i = document.querySelector('.block-properties input[name="${name}"]'); if (i.checked !== ${on}) i.click(); return i.checked; })()`);
const setColumns = (v) =>
  evalJs(`(() => { const s = document.querySelector('.block-properties select[name="columns"]'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const apply = () => evalJs(`(() => { document.querySelector('.block-properties button[type="submit"]').click(); return true; })()`);

await settled();

// ── CHECK 1 — Alt+Enter in the source editor ────────────────────────────────
const linePos = await evalJs(`(() => {
  const l = [...document.querySelectorAll('.cm-line')].find((e) => e.textContent.startsWith('@card'));
  if (!l) return null;
  const r = l.getBoundingClientRect();
  return { x: Math.round(r.left + 24), y: Math.round(r.top + r.height / 2) };
})()`);
if (!linePos) fail("CONTROL: the @card line is not in the editor");
await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...linePos });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...linePos });
await key("Enter", { modifiers: ALT, vk: 13 });
check(await waitFor(`!!document.querySelector('.block-properties')`, 8000), "Alt+Enter on a marker line opens Block properties");
const d1 = await dialog();
check(d1?.title?.includes("@card"), "the dialog names the marker (@card)", d1);
check(d1?.checks.some((c) => c.name === "class-gp-no-break" && !c.checked && c.group === "Gutterpress"), "core's Keep together is offered, off", d1);
check(d1?.checks.some((c) => c.name === "class-hs-tight" && !c.checked && c.group === "House"), "the plugin's catalog modifier .hs-tight is offered under the plugin's name, off", d1);
check(!d1?.checks.some((c) => c.name === "class-hs-old-split"), "a retired catalog modifier is not offered", d1);
check(!d1?.checks.some((c) => c.name === "class-hs-wide"), "a documented class that is not a modifier is not a toggle", d1);
check(d1?.columns === "" && d1?.columnsDisabled === false, "Columns starts at None and is available (the block has an @end-card)", d1);

await setCheck("class-hs-tight", true);
await setCheck("break-before", true);
await setColumns("2");
await apply();
await waitFor(`!document.querySelector('.block-properties')`, 5000, "the dialog did not close on Apply");
const edited = ORIGINAL
  .replace('@card .hs-wide label="Rule one"\n\n## Rule one', '@page-break\n\n@card .hs-wide label="Rule one" .hs-tight\n\n@columns 2\n\n## Rule one')
  .replace("look at.\n\n@end-card", "look at.\n\n@end-columns\n\n@end-card");
check(edited !== ORIGINAL, "(control) the expected text differs from the original");
check(
  await waitFile(edited),
  "the chapter file is exactly: break above, .hs-tight appended to the marker line (label and .hs-wide kept), content wrapped in @columns 2",
  { onDisk: file() },
);

// ── CHECK 2 — the same dialog from the preview's right-click menu ───────────
await settled();
const headingLine = file().split("\n").findIndex((l) => l.startsWith("## Rule one")) + 1;
// Wait for the preview to have re-rendered with the break (the card is now on page 2),
// then bring it on screen — a scroll sent before the re-render is lost with the old frame.
await waitFor(
  `(async () => ((await window.__ask('getOutline', [])) ?? []).some((e) => e.text === 'Rule one' && e.page >= 2))()`,
  60000,
  "CONTROL: the preview never re-rendered with the page break",
);
await evalJs(`window.__ask('scrollTo', [{ line: ${headingLine}, chapter: '01-chapter.md' }, { block: 'start' }])`);
await sleep(1200);
// The marker target is the card's own box (its padding), not a paragraph inside it.
const spot = await pollValue(
  `(async () => {
    const f = document.querySelector('iframe');
    const r = f.getBoundingClientRect();
    for (let y = 20; y < r.height - 20; y += 8) for (let x = 6; x < r.width - 6; x += 12) {
      const t = await window.__ask('getContextTargetAt', [{ x, y }]);
      if (t && t.kind === 'marker' && t.blockTag === 'div' && t.chapter === '01-chapter.md') return { x: Math.round(r.left + x), y: Math.round(r.top + y) };
    }
    return null;
  })()`,
  40000,
);
if (!spot) fail("CONTROL: no point on the card reports a marker target in the preview");
await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", buttons: 2, clickCount: 1, ...spot });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", buttons: 0, clickCount: 1, ...spot });
check(await waitFor(`!!document.querySelector('[role="menu"]')`, 8000), "right-clicking the card opens the context menu");
const menu = await evalJs(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.textContent.trim())`);
check(menu?.includes("Block properties…"), "the menu offers Block properties…", menu);
await evalJs(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.trim() === 'Block properties…')?.click(); true`);
check(await waitFor(`!!document.querySelector('.block-properties')`, 8000), "the menu item opens the dialog");
const d2 = await dialog();
check(d2?.checks.find((c) => c.name === "class-hs-tight")?.checked === true, "the dialog reads .hs-tight as on (written by the first edit)", d2);
check(d2?.checks.find((c) => c.name === "break-before")?.checked === true, "the dialog reads Break before as on", d2);
check(d2?.columns === "2", "the dialog reads Columns as 2", d2);
await setCheck("class-hs-tight", false);
await setCheck("break-before", false);
await setColumns("");
await apply();
await waitFor(`!document.querySelector('.block-properties')`, 5000, "the dialog did not close on Apply (preview path)");
check(await waitFile(ORIGINAL), "turning all three off restores the chapter file byte for byte", { onDisk: file() });

// ── CHECK 3 — .class autocomplete ───────────────────────────────────────────
await settled();
await evalJs(`document.querySelector('.cm-content').focus(); true`);
await key("End", { modifiers: CTRL, vk: 35 });
await type("\n\n@card .");
await sleep(1000);
const l1 = await items();
check(l1.some((t) => t.startsWith("gp-no-break")) && l1.some((t) => t.startsWith("hs-tight")) && l1.some((t) => t.startsWith("hs-wide")),
  "typing . after a marker word lists core's gp-* and the plugin's documented classes", l1.slice(0, 6));
check(l1.some((t) => t.includes("Pulls the card's margins in")), "an entry carries the catalog's one-line description", l1.slice(0, 6));
await type("hs-ti");
await sleep(600);
await key("Tab", { vk: 9 });
await sleep(300);
check((await lastLine()) === "@card .hs-tight", "Tab accepts a class: the line is '@card .hs-tight'", await lastLine());

await type("\n\n## Title {.");
await sleep(1000);
check((await items()).length > 8, "typing {. on a heading lists classes");
await type("gp-no");
await sleep(500);
await key("Enter", { text: "\r", vk: 13 });
await sleep(300);
check((await lastLine()) === "## Title {.gp-no-break", "Enter accepts a class: the line is '## Title {.gp-no-break'", await lastLine());

await type("}\n\n![Art](a.png){.");
await sleep(1000);
const l3 = await items();
check(l3.length > 8 && l3[0].startsWith("gp-"), "typing {. on an image lists core's image classes first", l3.slice(0, 3));
await key("Escape", { vk: 27 });

if (failures.length) {
  console.error(`[block-props] ${failures.length} check(s) failed`);
  cleanup();
  process.exit(1);
}
log("PASS");
cleanup();
process.exit(0);
