#!/usr/bin/env node
/**
 * Online copy end-to-end check (#448), driven over raw CDP (launch pattern of
 * problems-panel.pw.mjs: xvfb when headless, throwaway HOME,
 * --remote-debugging-port).
 *
 * What it verifies against the BUILT app (out/main/main.js or a packaged exe):
 *   1. An author opens a temp git book whose online copy is on GitHub. The
 *      status bar has ONE status control ("Saved · …"), no second save
 *      indicator or sync pill, and clicking it opens Book setup on the
 *      Online copy tab.
 *   2. The tab shows the status headline with its one action, the "Saved ·
 *      last version …" line with Save a version and Version history…, and a
 *      Revisions list. The four revision calls are STUBBED in the page (the
 *      list/create/rename/delete routes live in the host and are covered by
 *      their own tests): the open revision is first, the rest by name; each
 *      row says where it is kept and offers exactly the actions the design
 *      allows (never Delete on the open one; Switch and Delete… on an
 *      online-only one). Past five revisions the list scrolls in its own box
 *      and offers "Find a revision" (case-insensitive; "No revisions match.").
 *   3. Version history… opens INSIDE the tab (Book setup stays up, the rest
 *      of the tab is hidden, the editor pane is untouched); a changed file
 *      opens its compare there, and Online copy brings the tab back. Look at
 *      this version closes Book setup and shows the preview's own "Looking at
 *      …" bar, whose close button stops looking.
 *   4. New revision… sits above the list (and its name form opens there;
 *      Escape in it cancels the form, not Book setup), previews the name, creates it and lists it; Rename… of an online
 *      revision shows the "also renames it in the online copy" note; deleting
 *      an online revision offers "this computer only" and "everywhere"; an
 *      online-only one is one step ("from the online copy? It isn't on this
 *      computer."); one holding versions found nowhere else asks a second
 *      time, naming how many, and the second call carries `discard: true`.
 *   5. Once backing up can work (the diagnosis is stubbed as ready), "If
 *      backing up keeps failing" holds Test connection, Sign in again, Repair
 *      the online copy and Start over from the online copy, collapsed. Save a
 *      version, clicked like a person does, disables itself while it saves,
 *      which drops focus to <body>; Escape pressed then still closes Book setup
 *      (the original #448 bug, fixed by dialogBehavior in #451).
 *   6. For a book that can back up (closing Accounts makes the app look at its
 *      online copy again, stubbed as ready) the status bar shows no Sync while
 *      automatic backing up is on, and ONE Sync button after the status control
 *      once it is off: it runs a pass, reads "Syncing…" while it runs, and
 *      carries the "new changes are online" cue and toast action. It still
 *      fits, with the status line ellipsized, at 700px and (cut short) at 260px.
 *   7. A Reader sees no status control and no Sync, even in that state.
 *
 * Screenshots: <os tmpdir>/online-copy-{bar,bar-auto,bar-sync,bar-sync-updates,
 * bar-narrow,tab,filter,history,compare,rename,delete,delete-online,failing,reader}.png.
 *
 * Usage: node tests/integration/online-copy.pw.mjs [exe-or-main-js] [fixture-dir]
 * Exit 0 on pass, 1 on fail.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const PORT = 9800 + Math.floor(Math.random() * 150);

const log = (m) => console.log(`[online-copy] ${m}`);
let child = null;
let fakeHome = null;
let bookDir = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  // SIGKILL the whole process group: Electron does not reliably die on SIGTERM
  // (see problems-panel.pw.mjs).
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child?.kill("SIGKILL"); } catch {} }
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  try { if (bookDir) rmSync(bookDir, { recursive: true, force: true }); } catch {}
}
const fail = (m) => {
  console.error(`[online-copy] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
const check = (ok, m) => {
  if (!ok) fail(m);
  log(`ok: ${m}`);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. a git book whose online copy is on GitHub ─────────────────────────────
const [, , exeArg, fixtureArg] = process.argv;
const srcFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(srcFixture)) fail(`fixture not found: ${srcFixture}`);
bookDir = mkdtempSync(join(tmpdir(), "gutterpress-online-copy-fixture-"));
cpSync(srcFixture, bookDir, { recursive: true });
const git = (...args) => execFileSync("git", ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", ...args], { cwd: bookDir, stdio: "ignore" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "First version");
git("remote", "add", "origin", "https://github.com/ada/harbor-lights.git");
log(`seeded book: ${bookDir}`);

// ── 2. launch the built app, as an author ────────────────────────────────────
const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-online-copy-home-"));
const userDataDir = join(fakeHome, "user-data");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(join(userDataDir, "app-settings.json"), JSON.stringify({ workspace: { role: "author" } }));
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, "--no-sandbox"];
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
  fail("CDP endpoint / app:// page target never appeared (60s)");
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
  if (r.result?.exceptionDetails) fail(`page eval threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value;
}
async function screenshot(file) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  log(`screenshot: ${file}`);
}
async function waitFor(expression, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evalJs(expression)) return true;
    await sleep(250);
  }
  return false;
}
/** Click the first element matching `selector` whose trimmed text is `text` (or any, when `text` is null). */
const click = (selector, text = null) =>
  evalJs(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text === null ? "true" : `e.textContent.trim() === ${JSON.stringify(text)}`});
    el?.click();
    return !!el;
  })()`);
/** Click the element `expr` finds the way a person does: a real mouse press, which also focuses it. */
async function mouseClick(expr) {
  const at = await evalJs(`(() => {
    const el = ${expr};
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!at) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  }
  return true;
}
/** Type into the input matching `selector` the way a person does (fires input events). */
const type = (selector, value) =>
  evalJs(`(() => {
    const inp = document.querySelector(${JSON.stringify(selector)});
    if (!inp) return false;
    inp.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(value)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
/** Press a key the way a person does: through the browser, to whatever has focus. */
const press = async (key, code = key, keyCode = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
};
await send("Page.bringToFront");

// ── 4. open the seeded book via the left panel Books tab ─────────────────────
check(await waitFor(`!!document.querySelector('button[aria-label="Toggle left panel"]')`, 60000), "the app is interactive");
if (!(await waitFor(`!!document.querySelector('.projects-body .location-input')`, 10000))) {
  await click('button[aria-label="Toggle left panel"]');
  await sleep(500);
  await evalJs(`[...document.querySelectorAll('.panel-tab')].find((b) => b.textContent.trim().toUpperCase().includes('BOOKS'))?.click(); true`);
}
await evalJs(`(async () => {
  const inp = document.querySelector('.projects-body .location-input');
  if (!inp) return false;
  inp.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(bookDir)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
check(await waitFor(`!!(document.querySelector('.toc-item') || document.querySelector('.file-item'))`, 120000), "the book opened");

// ── 5. the revision calls, stubbed in the page ───────────────────────────────
await evalJs(`(() => {
  const state = {
    calls: [],
    revisions: [
      { name: "main", current: true, where: "online", notBackedUp: true },
      { name: "second-edition", current: false, where: "this-computer", notBackedUp: false },
      { name: "release-1", current: false, where: "online", notBackedUp: false },
      { name: "editors-pass", current: false, where: "online-only", notBackedUp: false },
      { name: "late-draft", current: false, where: "online-only", notBackedUp: false },
      { name: "side-project", current: false, where: "online-only", notBackedUp: false },
      { name: "appendix", current: false, where: "this-computer", notBackedUp: false },
    ],
  };
  window.__revisions = state;
  const real = window.fetch.bind(window);
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const current = () => state.revisions.find((r) => r.current)?.name ?? null;
  window.fetch = async (input, init) => {
    const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
    if (window.__diagnoseReady && path === "/api/remote/diagnose-project") {
      return json({
        classification: { type: "local-git-folder", path: "/book", repoRoot: "/book", subPath: "", hasRemote: true },
        remoteUrl: "https://github.com/ada/harbor-lights.git", remoteHost: "github.com", remoteProtocol: "https",
        credentialPresent: true, provider: "github", tokenSettingsUrl: null, canSync: true, guidance: "ready-to-sync",
      });
    }
    if (!/^\\/api\\/vcs\\/(list-revisions|create-revision|rename-revision|delete-revision|switch-branch)$/.test(path)) return real(input, init);
    const body = init?.body ? JSON.parse(init.body) : {};
    state.calls.push({ path: path.slice("/api/vcs/".length), body });
    switch (path) {
      case "/api/vcs/list-revisions":
        return json({ current: current(), revisions: [...state.revisions].sort((a, b) => a.name.localeCompare(b.name)), checkedOnline: false });
      case "/api/vcs/create-revision": {
        const name = body.name.trim().replace(/\\s+/g, "-");
        state.revisions.forEach((r) => (r.current = false));
        state.revisions.push({ name, current: true, where: "this-computer", notBackedUp: false });
        return json({ current: name });
      }
      case "/api/vcs/rename-revision": {
        const r = state.revisions.find((x) => x.name === body.from);
        r.name = body.to.trim().replace(/\\s+/g, "-");
        return json({ current: current(), name: r.name });
      }
      case "/api/vcs/delete-revision": {
        if (body.name === "second-edition" && !body.discard) return json({ deleted: false, versionsOnlyHere: 2 });
        if (body.name === "side-project" && !body.discard) return json({ deleted: false, versionsOnlyHere: 3 });
        state.revisions = state.revisions.filter((r) => r.name !== body.name);
        return json({ deleted: true });
      }
      default: {
        state.revisions.forEach((r) => (r.current = r.name === body.branch));
        return json({ current: body.branch, changedFiles: [] });
      }
    }
  };
  return true;
})()`);

// ── 6. one status control, which opens Book setup on Online copy ─────────────
check(await waitFor(`!!document.querySelector('.status-bar .status-control')`), "the status bar has a status control");
const bar = await evalJs(`(() => ({
  controls: document.querySelectorAll('.status-bar .status-control').length,
  text: document.querySelector('.status-bar .status-control .status-text')?.textContent.trim(),
  oldIndicator: !!document.querySelector('.status-bar .save-indicator, .status-bar .sync-pill'),
}))()`);
check(bar.controls === 1 && !bar.oldIndicator, `exactly one status control, no save indicator or sync pill (${JSON.stringify(bar)})`);
check(/^Saved/.test(bar.text), `the control starts with "Saved" (${bar.text})`);
await screenshot(join(tmpdir(), "online-copy-bar.png"));
await click(".status-bar .status-control");
check(await waitFor(`document.querySelector('#project-settings-tab-online-copy')?.getAttribute('aria-selected') === 'true'`), "clicking it opens Book setup on the Online copy tab");

// ── 7. the tab: three cards — where the book is kept, Revisions, Version history ─
check(await waitFor(`!!document.querySelector('#project-settings-panel .revisions .rev-list li.rev') && !!document.querySelector('#project-settings-panel .recent .recent-row')`), "the status, Revisions and Version history cards loaded");
await sleep(400);
await screenshot(join(tmpdir(), "online-copy-tab.png"));
const tab = await evalJs(`(() => {
  const panel = document.querySelector('#project-settings-panel');
  const cards = [...panel.querySelectorAll('.online-copy > .section-card')];
  const rows = [...panel.querySelectorAll('.revisions .rev-list > li.rev')].map((li) => ({
    name: li.querySelector('.rev-name')?.textContent.trim(),
    current: li.classList.contains('current'),
    badge: li.querySelector('.badge')?.textContent.trim() ?? null,
    where: li.querySelector('.rev-where')?.textContent.replace(/\\s+/g, ' ').trim(),
    buttons: [...li.querySelectorAll('.rev-actions > button')].map((b) => b.textContent.trim()),
    more: !!li.querySelector('button[aria-label^="More for"]'),
  }));
  return {
    titles: cards.map((c) => c.querySelector('h3')?.textContent.trim()),
    statusDetail: panel.querySelector('.status-text p')?.textContent.trim(),
    signIn: [...panel.querySelectorAll('.status-body button')].some((b) => /Sign in/.test(b.textContent)),
    revisionsHead: [...panel.querySelectorAll('.revisions .section-head button')].map((b) => b.textContent.trim()),
    find: !!panel.querySelector('.revisions input[aria-label="Find a revision"]'),
    showAll: panel.querySelector('.revisions .section-foot button')?.textContent.trim(),
    note: panel.querySelector('.revisions .section-note')?.textContent.trim(),
    historyHead: [...panel.querySelectorAll('[aria-labelledby="version-history-title"] .section-head button')].map((b) => b.textContent.trim()),
    recent: panel.querySelectorAll('.recent .recent-row').length,
    trouble: !!panel.querySelector('details.trouble'),
    innerScroll: (() => { const l = panel.querySelector('.revisions .rev-list'); return l.scrollHeight > l.clientHeight + 1; })(),
    rows,
  };
})()`);
log(`tab: ${JSON.stringify(tab)}`);
const row = (n) => tab.rows.find((r) => r.name === n) ?? {};
check(tab.titles.join("|") === "Sign in to back up|Revisions|Version history", `three cards, in order: status, Revisions, Version history (${tab.titles.join(" | ")})`);
check(/GitHub: ada\/harbor-lights/.test(tab.statusDetail) && tab.signIn, "the status card names the online copy and offers Sign in…");
check(tab.revisionsHead.join("|") === "New revision", "New revision sits in the Revisions card's header");
check(tab.find, "more than five revisions offer Find a revision");
check(tab.rows.map((r) => r.name).join(",") === "main,appendix,editors-pass,late-draft,release-1", `five rows show, the open one first (${tab.rows.map((r) => r.name)})`);
check(tab.showAll === "Show all 7 revisions" && !tab.innerScroll, "the rest are one click away (Show all), with no box scrolling inside the page");
check(row("main").current && row("main").badge === "Current" && row("main").where === "Online · not backed up yet" && row("main").buttons.length === 0 && row("main").more, "the open revision: Current, where it is kept, and its menu (no Switch)");
check(row("editors-pass").where === "Only online" && row("editors-pass").buttons.join("|") === "Switch" && row("editors-pass").more, "an online-only revision: Switch and its menu");
check(row("appendix").where === "Only on this computer", "a revision only on this computer says so");
check(/revisions made elsewhere may be missing/.test(tab.note ?? ""), "an online copy that could not be checked says so, once");
check(tab.historyHead.join("|") === "Save a version|Browse versions" && tab.recent >= 1 && tab.recent <= 3, `Version history is a short card: the newest versions, Save a version and Browse versions (${tab.historyHead.join("|")}, ${tab.recent} rows)`);
check(!tab.trouble, "the backing-up-keeps-failing tools are only there once backing up can work");

/** Open a row's "more" menu and choose an item. */
const menuAction = async (name, label) => {
  await click(`#project-settings-panel button[aria-label="More for ${name}"]`);
  await waitFor(`!!document.querySelector('#project-settings-panel .menu [role="menuitem"]')`, 3000);
  const items = await evalJs(`[...document.querySelectorAll('#project-settings-panel .menu [role="menuitem"]')].map((b) => b.textContent.trim()).join('|')`);
  const ok = await click(`#project-settings-panel .menu [role="menuitem"]`, label);
  return { ok, items };
};
const names = () => evalJs(`[...document.querySelectorAll('#project-settings-panel .revisions .rev-list > li .rev-name')].map((e) => e.textContent.trim()).join(',')`);
const dialogText = () => evalJs(`document.querySelector('form.rev-dialog')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const dialogButtons = () => evalJs(`[...document.querySelectorAll('form.rev-dialog .dlg-actions button')].map((b) => b.textContent.trim()).join('|')`);
const dialogClick = (label) => click("form.rev-dialog .dlg-actions button", label);

// Every revision can be renamed; every one but the open one can be deleted.
const openMenu = await menuAction("main", "Rename…");
check(openMenu.items === "Rename…", `the open revision's menu: Rename… only (${openMenu.items})`);
await dialogClick("Cancel");
const onlineOnlyMenu = await menuAction("editors-pass", "Rename…");
check(onlineOnlyMenu.items === "Rename…|Delete…", `an online-only revision's menu: Rename… and Delete… (${onlineOnlyMenu.items})`);
await dialogClick("Cancel");
check(await waitFor(`!document.querySelector('form.rev-dialog')`, 3000), "Cancel closes the dialog");

// ── 7b. Find a revision ──────────────────────────────────────────────────────
await type('.revisions input[aria-label="Find a revision"]', "A");
await sleep(100);
check((await names()) === "main,appendix,editors-pass,late-draft,release-1", `the filter ignores case and keeps the open revision first (${await names()})`);
await type('.revisions input[aria-label="Find a revision"]', "PASS");
await sleep(100);
check((await names()) === "editors-pass", `matches names anywhere (${await names()})`);
await screenshot(join(tmpdir(), "online-copy-filter.png"));
await type('.revisions input[aria-label="Find a revision"]', "zzz");
await sleep(100);
check(await evalJs(`document.querySelector('#project-settings-panel .revisions .rev-list')?.textContent.includes('No revisions match.')`), "a filter that matches nothing says so");
await type('.revisions input[aria-label="Find a revision"]', "");
await click("#project-settings-panel .revisions .section-foot button", "Show all 7 revisions");
await sleep(100);
check((await names()).split(",").length === 7, "Show all lists every revision");

// ── 7c. Version history: a screen of its own, over Book setup ────────────────
// Save a version, from the card's header (the book has nothing new, which is said calmly).
await click('#project-settings-panel [aria-labelledby="version-history-title"] .section-head button', "Save a version");
check(await waitFor(`/Nothing new to save|nothing new/i.test(document.querySelector('#project-settings-panel [aria-labelledby="version-history-title"]')?.textContent ?? '')`, 20000), "Save a version says so when there is nothing new");

await click('#project-settings-panel [aria-labelledby="version-history-title"] .section-head button', "Browse versions");
check(await waitFor(`!!document.querySelector('.vh .ver')`), "Browse versions opens the Version history screen");
const vh = await evalJs(`(() => {
  const root = document.querySelector('.vh');
  return {
    title: root.querySelector('#vh-title')?.textContent.trim(),
    selected: root.querySelectorAll('.ver.selected').length,
    firstSelected: root.querySelector('.ver')?.classList.contains('selected'),
    head: root.querySelector('.detail-head h2')?.textContent.trim(),
    actions: [...root.querySelectorAll('.detail-actions button')].map((b) => b.textContent.trim()),
    tabs: [...root.querySelectorAll('.tabs [role="tab"]')].map((b) => b.textContent.trim()),
    bookSetupUnder: !!document.querySelector('#project-settings-panel'),
    inEditorPane: !!document.querySelector('.editor-pane .vh, .editor-pane .ver'),
  };
})()`);
log(`version history: ${JSON.stringify(vh)}`);
check(vh.title === "Version history" && vh.bookSetupUnder && !vh.inEditorPane, "it is its own screen, over Book setup, not in the editor");
check(vh.selected === 1 && vh.firstSelected && vh.head, `the newest version is selected and named at the top (${vh.head})`);
check(vh.actions.join("|") === "Restore this version", "Restore this version sits at the top of the selected version");
check(vh.tabs[0] === "Pages" && /^Changed files/.test(vh.tabs[1] ?? ""), `the version shows its Pages or its Changed files (${vh.tabs.join(", ")})`);
check(await waitFor(`!!document.querySelector('.vh .pages iframe') || /Couldn't show/.test(document.querySelector('.vh .pages')?.textContent ?? '')`, 60000), "its pages render on the right");
await sleep(1500);
await screenshot(join(tmpdir(), "online-copy-history.png"));

// Changed files: a text file opens line by line, and back.
await click(".vh .tabs [role='tab']", vh.tabs[1]);
check(await waitFor(`!!document.querySelector('.vh .files .file')`), "Changed files lists the files it changed");
await click(".vh .files button.file");
check(await waitFor(`!!document.querySelector('.vh .compare-view .columns')`), "a changed text file opens line by line");
await screenshot(join(tmpdir(), "online-copy-compare.png"));
await click(".vh .compare-view .back");
check(await waitFor(`!!document.querySelector('.vh .files')`), "and goes back to the list");

// Restore asks once, at the top.
await click(".vh .detail-actions button", "Restore this version");
check(await waitFor(`/saved as a version first/.test(document.querySelector('.vh .detail-actions')?.textContent ?? '')`, 3000), "Restore says your current work is saved as a version first");
check((await evalJs(`[...document.querySelectorAll('.vh .detail-actions button')].map((b) => b.textContent.trim()).join('|')`)) === "Cancel|Restore", "and asks Cancel or Restore");
await click(".vh .detail-actions button", "Cancel");

// Closing returns to Book setup, where it was opened.
await click(".vh .vh-close");
check(await waitFor(`!document.querySelector('.vh') && !!document.querySelector('#project-settings-panel .revisions .rev-list li.rev')`), "closing Version history returns to Online copy");

// A version in the card opens the screen on that version.
await click("#project-settings-panel .recent .recent-row");
check(await waitFor(`!!document.querySelector('.vh .ver.selected')`), "a version in the card opens the screen on it");
await press("Escape", "Escape", 27);
check(await waitFor(`!document.querySelector('.vh') && !!document.querySelector('#project-settings-panel')`), "Escape closes Version history and leaves Book setup open");

// ── 8. New revision (a dialog) ───────────────────────────────────────────────
await click("#project-settings-panel .revisions .section-head button", "New revision");
check(await waitFor(`!!document.querySelector('form.rev-dialog input')`, 3000), "New revision opens a dialog with a name field");
check(await evalJs(`document.activeElement === document.querySelector('form.rev-dialog input')`), "the name field has focus");
// Escape cancels the dialog only: Book setup stays open.
await press("Escape", "Escape", 27);
check(await waitFor(`!document.querySelector('form.rev-dialog')`, 3000), "Escape cancels the dialog");
check(await evalJs(`!!document.querySelector('#project-settings-panel .revisions')`), "and leaves Book setup open");
await click("#project-settings-panel .revisions .section-head button", "New revision");
await waitFor(`!!document.querySelector('form.rev-dialog input')`, 3000);
await type("form.rev-dialog input", "Third edition");
await sleep(100);
const newText = await dialogText();
check(newText.includes('It will be called "Third-edition".'), `the dialog previews the name (${newText})`);
check(newText.includes("starts from your book as it is now") && newText.includes("goes online the next time you back up"), "and says what it does");
await screenshot(join(tmpdir(), "online-copy-new.png"));
await dialogClick("Create revision");
check(await waitFor(`!document.querySelector('form.rev-dialog') && document.querySelector('#project-settings-panel .revisions .rev.current .rev-name')?.textContent.trim() === 'Third-edition'`), "the new revision is created, open, and listed");
const created = await evalJs(`window.__revisions.calls.find((c) => c.path === 'create-revision')?.body`);
check(created?.name === "Third edition", "the typed name went to the host (it normalises it)");
check((await names()).startsWith("Third-edition,"), "and it moves to the top of the list");

// ── 9. Rename… (an online revision, and one only online) ─────────────────────
await menuAction("main", "Rename…");
await type("form.rev-dialog input", "first edition");
await sleep(100);
check((await dialogText()).includes('This also renames it in the online copy. Anyone else working on "main" keeps the old name until they switch to the new one.'), "an online rename says it renames online too");
await screenshot(join(tmpdir(), "online-copy-rename.png"));
await dialogClick("Rename");
check(await waitFor(`!document.querySelector('form.rev-dialog') && [...document.querySelectorAll('#project-settings-panel .rev-name')].some((e) => e.textContent.trim() === 'first-edition')`), "the revision is renamed");
await menuAction("editors-pass", "Rename…");
await type("form.rev-dialog input", "editors final");
await sleep(100);
check((await dialogText()).includes("It is renamed in the online copy. It isn't on this computer."), "an online-only rename says where it happens");
await dialogClick("Rename");
check(await waitFor(`[...document.querySelectorAll('#project-settings-panel .rev-name')].some((e) => e.textContent.trim() === 'editors-final')`), "the online-only revision is renamed");
check(await evalJs(`window.__revisions.calls.some((c) => c.path === 'rename-revision' && c.body.from === 'editors-pass' && c.body.to === 'editors final')`), "the host was asked to rename it");

// ── 10. Delete… (a dialog; a second step when versions would be lost) ─────────
await menuAction("release-1", "Delete…");
check((await dialogButtons()) === "Cancel|Delete on this computer only|Delete everywhere", `an online revision offers this computer only, or everywhere (${await dialogButtons()})`);
await dialogClick("Delete everywhere");
check(await waitFor(`![...document.querySelectorAll('#project-settings-panel .rev-name')].some((e) => e.textContent.trim() === 'release-1')`), "deleted everywhere");
check(await evalJs(`window.__revisions.calls.some((c) => c.path === 'delete-revision' && c.body.name === 'release-1' && c.body.everywhere === true)`), "the host was asked to delete it everywhere");

await menuAction("second-edition", "Delete…");
await dialogClick("Delete");
check(await waitFor(`/2 versions/.test(document.querySelector('form.rev-dialog .warn')?.textContent ?? '')`), "a revision holding versions found nowhere else asks again, naming how many");
await screenshot(join(tmpdir(), "online-copy-delete.png"));
await dialogClick("Delete anyway");
check(await waitFor(`![...document.querySelectorAll('#project-settings-panel .rev-name')].some((e) => e.textContent.trim() === 'second-edition')`), "deleted after the second confirmation");
check(await evalJs(`window.__revisions.calls.filter((c) => c.path === 'delete-revision' && c.body.name === 'second-edition').map((c) => !!c.body.discard).join() === 'false,true'`), "the second call carried discard: true");

await menuAction("late-draft", "Delete…");
check((await dialogText()).includes("It is deleted from the online copy. It isn't on this computer.") && (await dialogButtons()) === "Cancel|Delete", "an online-only revision is deleted from the online copy, in one step");
await screenshot(join(tmpdir(), "online-copy-delete-online.png"));
await dialogClick("Delete");
check(await waitFor(`![...document.querySelectorAll('#project-settings-panel .rev-name')].some((e) => e.textContent.trim() === 'late-draft')`), "the online-only revision is gone");
check(await evalJs(`window.__revisions.calls.some((c) => c.path === 'delete-revision' && c.body.name === 'late-draft' && c.body.everywhere === true && !c.body.discard)`), "the host was asked to delete it from the online copy");

await menuAction("side-project", "Delete…");
await dialogClick("Delete");
check(await waitFor(`/3 versions/.test(document.querySelector('form.rev-dialog .warn')?.textContent ?? '')`), "an online-only revision holding versions found nowhere else asks again, naming how many");
await dialogClick("Delete anyway");
check(await waitFor(`![...document.querySelectorAll('#project-settings-panel .rev-name')].some((e) => e.textContent.trim() === 'side-project')`), "deleted after the second confirmation");

// Down to four revisions: no filter, no Show all.
check(await evalJs(`document.querySelectorAll('#project-settings-panel .revisions .rev-list > li.rev').length === 4 && !document.querySelector('#project-settings-panel .revisions input[aria-label="Find a revision"]') && !document.querySelector('#project-settings-panel .revisions .section-foot')`), "five revisions or fewer: no filter and no Show all");

// ── 11. Switch ───────────────────────────────────────────────────────────────
await click('#project-settings-panel button[aria-label="Switch to editors-final"]');
check(await waitFor(`document.querySelector('#project-settings-panel .revisions .rev.current .rev-name')?.textContent.trim() === 'editors-final'`), "Switch opens an online-only revision");

// ── 12. once backing up can work: the tools for when it keeps failing ────────
const closeDialog = () => evalJs(`document.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
await closeDialog();
check(await waitFor(`!document.querySelector('#project-settings-panel')`), "Book setup closed");
await evalJs(`window.__diagnoseReady = true; true`);
await click(".status-bar .status-control");
check(await waitFor(`!!document.querySelector('#project-settings-panel details.trouble')`), "the backing-up-keeps-failing tools are there once backing up can work");
const failing = await evalJs(`(() => {
  const d = document.querySelector('#project-settings-panel details.trouble');
  return {
    open: d.open,
    inStatusCard: !!d.closest('.status'),
    summary: d.querySelector('summary').textContent.trim(),
    rows: [...d.querySelectorAll('.tool strong')].map((b) => b.textContent.trim()),
    title: document.querySelector('#project-settings-panel .status-text h3')?.textContent.trim(),
  };
})()`);
log(`ready tab: ${JSON.stringify(failing)}`);
check(!failing.open && failing.inStatusCard && failing.summary === "Backing up keeps failing?", "they sit, collapsed, at the foot of the status card");
check(failing.rows.join("|") === "Test connection|Sign in again|Repair the online copy|Start over from the online copy", "the four tools, Sign in again right after Test connection");
await evalJs(`document.querySelector('#project-settings-panel details.trouble').open = true; true`);
await sleep(200);
await screenshot(join(tmpdir(), "online-copy-failing.png"));
check(/^Online copy: github\.com\/ada\/harbor-lights$/.test(failing.title), `the status names the online copy without claiming a backup (${failing.title})`);

// Save a version, then Escape: the button is disabled while it saves, so the focus a click gave
// it drops to <body>, outside Book setup. Escape must still close Book setup (#448, #451).
const saveVersionBtn = `[...document.querySelectorAll('#project-settings-panel [aria-labelledby="version-history-title"] .section-head button')].find((b) => b.textContent.trim() === 'Save a version')`;
check(await mouseClick(saveVersionBtn), "Save a version, clicked");
check(await waitFor(`/Nothing new to save/.test(document.querySelector('#project-settings-panel [aria-labelledby="version-history-title"]')?.textContent ?? '') && !!(${saveVersionBtn}) && !(${saveVersionBtn}).disabled`, 20000), "Save a version finished (nothing new) and is ready again");
const focusAfterSave = await evalJs(`document.activeElement === document.body ? "body" : document.activeElement?.closest('#project-settings-panel') ? "in Book setup" : String(document.activeElement?.tagName)`);
log(`focus after Save a version: ${focusAfterSave}`);
await press("Escape", "Escape", 27);
check(await waitFor(`!document.querySelector('#project-settings-panel')`, 3000), `Escape after Save a version closes Book setup (focus was ${focusAfterSave})`);

// ── 12b. automatic backing up off: one Sync button beside the status control ─
// The sync and update-check calls are stubbed in the page. Closing Accounts makes
// the app look at the online copy again (now stubbed as ready), so the book can
// back up; Sync shows only once Settings turns automatic backing up off.
await evalJs(`(() => {
  const real = window.fetch.bind(window);
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  window.__sync = { calls: [], release: null, updatesOnline: false, diagnosed: 0 };
  window.fetch = (input, init) => {
    const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
    if (path === "/api/remote/diagnose-project") window.__sync.diagnosed++;
    if (path === "/api/remote/check-updates") return Promise.resolve(json({ available: window.__sync.updatesOnline }));
    if (path === "/api/remote/sync") {
      window.__sync.calls.push(JSON.parse(init.body));
      return new Promise((resolve) => { window.__sync.release = () => resolve(json({ status: "synced", message: "", mergedRemoteChanges: false })); });
    }
    return real(input, init);
  };
  return true;
})()`);
const openSettings = async () => {
  await click('.status-bar button[aria-label="Settings"]');
  check(await waitFor(`!!document.querySelector('#settings-autosync')`), "Settings opened");
};
const closeSettings = async () => {
  await click('button[aria-label="Close settings"]');
  check(await waitFor(`!document.querySelector('#settings-autosync')`), "Settings closed");
};
await openSettings();
await click("button", "Accounts…");
check(await waitFor(`!!document.querySelector('button[aria-label="Close accounts"]')`), "Accounts opened over Settings");
await click('button[aria-label="Close accounts"]');
check(await waitFor(`window.__sync.diagnosed > 0`), "closing Accounts made the app look at the online copy again");
await closeSettings();
await sleep(500);
const syncBtn = `[...document.querySelectorAll('.status-bar button')].find((b) => /^Sync/.test(b.textContent.trim()))`;
check(!(await evalJs(`!!(${syncBtn})`)), "a book that can back up shows no Sync while automatic backing up is on");
await screenshot(join(tmpdir(), "online-copy-bar-auto.png"));
await openSettings();
await evalJs(`(() => { const sw = document.querySelector('#settings-autosync'); sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await closeSettings();
check(await waitFor(`!!(${syncBtn})`), "the status bar offers Sync once automatic backing up is off");
const shape = await evalJs(`(() => {
  const bar = document.querySelector('.status-bar');
  const btn = ${syncBtn};
  const left = (el) => el.getBoundingClientRect().left;
  return {
    text: btn.textContent.trim(),
    title: btn.title,
    hasIcon: !!btn.querySelector('svg'),
    disabled: btn.disabled,
    order: [left(bar.querySelector('button[aria-label^="Books"]')), left(bar.querySelector('.status-control')), left(btn), left(bar.querySelector('button[aria-label="Settings"]'))],
    labels: [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim()),
  };
})()`);
log(`bar with Sync: ${JSON.stringify(shape)}`);
check(shape.text === "Sync" && shape.hasIcon && !shape.disabled, "it is an icon and the word Sync");
check(shape.title === "Sync: get the latest changes from the online copy, then back up yours", `its tooltip says what it does (${shape.title})`);
check(shape.order.every((x, i) => i === 0 || x > shape.order[i - 1]), `the bar reads Books, status, Sync, then settings (${shape.order.map(Math.round)})`);
check(!shape.labels.some((l) => /Get latest|Back up now/.test(l)), `no Get latest or Back up now beside it (${shape.labels.join(", ")})`);
await screenshot(join(tmpdir(), "online-copy-bar-sync.png"));

await click(".status-bar button", "Sync");
check(await waitFor(`${syncBtn}?.textContent.trim() === 'Syncing…' && ${syncBtn}.disabled`), "while it runs it reads Syncing… and is disabled");
check(await evalJs(`window.__sync.calls.length === 1 && window.__sync.calls[0].push === undefined`), "it ran one full pass (no get-only flag)");
await evalJs(`window.__sync.release(); true`);
check(await waitFor(`${syncBtn}?.textContent.trim() === 'Sync' && !${syncBtn}.disabled`), "it is back to Sync when the pass ends");

await evalJs(`window.__sync.updatesOnline = true; window.dispatchEvent(new Event('focus')); true`);
const prompt = `[...document.querySelectorAll('.toast')].find((t) => t.querySelector('.toast-message')?.textContent.trim() === 'New changes are online for this book.')`;
check(await waitFor(`!!(${prompt})`), "new changes online raise the toast");
const cue = await evalJs(`(() => ({
  toast: (${prompt}).querySelector('.toast-message').textContent.trim(),
  action: (${prompt}).querySelector('.toast-action')?.textContent.trim(),
  label: (${syncBtn}).getAttribute('aria-label'),
  title: (${syncBtn}).title,
}))()`);
check(cue.toast === "New changes are online for this book." && cue.action === "Sync", `the toast offers Sync (${cue.action})`);
check(cue.label === "Sync — new changes are online" && /^Sync — new changes are online/.test(cue.title), `the Sync button carries the cue (${cue.label})`);
await screenshot(join(tmpdir(), "online-copy-bar-sync-updates.png"));
await click(".toast-action", "Sync");
check(await waitFor(`${syncBtn}?.textContent.trim() === 'Syncing…'`), "the toast's Sync runs the same pass");
check(await evalJs(`window.__sync.calls.length === 2`), "it made the second pass");
await evalJs(`window.__sync.release(); true`);
check(await waitFor(`${syncBtn}?.textContent.trim() === 'Sync' && !${syncBtn}.getAttribute('aria-label')`), "the cue clears once the pass ends");

// Narrow: the status line gives way (ellipsis, truly cut at 260px) and everything stays on the bar.
for (const width of [700, 260]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  const narrow = await evalJs(`(() => {
    const bar = document.querySelector('.status-bar').getBoundingClientRect();
    const btn = ${syncBtn};
    const text = document.querySelector('.status-bar .status-text');
    const rects = [...document.querySelectorAll('.status-bar button')].map((b) => b.getBoundingClientRect());
    return {
      spill: rects.some((r) => r.right > bar.right + 1 || r.left < bar.left - 1),
      syncShown: btn.getClientRects().length > 0,
      ellipsis: getComputedStyle(text).textOverflow === 'ellipsis' && getComputedStyle(text).overflow === 'hidden',
      cut: text.scrollWidth > text.clientWidth,
      syncBeforeSettings: btn.getBoundingClientRect().right <= document.querySelector('.status-bar button[aria-label="Settings"]').getBoundingClientRect().left,
    };
  })()`);
  check(!narrow.spill && narrow.syncShown && narrow.ellipsis && narrow.syncBeforeSettings && (width > 260 || narrow.cut), `at ${width}px it still fits (${JSON.stringify(narrow)})`);
  if (width === 260) await screenshot(join(tmpdir(), "online-copy-bar-narrow.png"));
}
await send("Emulation.clearDeviceMetricsOverride");
await sleep(500);

// ── 13. a Reader sees none of it ─────────────────────────────────────────────
await click('.status-bar button[aria-label="Settings"]');
check(await waitFor(`!!document.querySelector('input[name="settings-role"][value="reader"]')`), "Settings opened");
await click('input[name="settings-role"][value="reader"]');
await evalJs(`document.querySelector('input[name="settings-role"][value="reader"]').dispatchEvent(new Event('change', { bubbles: true })); true`);
await closeDialog();
check(await waitFor(`!document.querySelector('input[name="settings-role"]')`), "Settings closed");
check(await waitFor(`!document.querySelector('.status-bar .status-control')`), "a Reader has no status control");
const readerBar = await evalJs(`[...document.querySelectorAll('.status-bar button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())`);
check(!readerBar.some((l) => /Sync|Get latest|Back up now/.test(l)), `a Reader has no Sync, even with automatic backing up off (${readerBar.join(", ")})`);
await screenshot(join(tmpdir(), "online-copy-reader.png"));

log("PASS: one status control, the Online copy tab, Version history inside it, revisions (find, new, rename, delete, switch) and the Reader's bare status bar all verified");
cleanup();
process.exit(0);
