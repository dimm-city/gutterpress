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
 *      their own tests): each row says where it is kept and offers exactly
 *      the actions the design allows (never Delete on the open one; Switch
 *      only on an online-only one).
 *   3. New revision… previews the name, creates it and lists it; Rename… of
 *      an online revision shows the "also renames it in the online copy"
 *      note; deleting an online revision offers "this computer only" and
 *      "everywhere"; one holding versions found nowhere else asks a second
 *      time, naming how many, and the second call carries `discard: true`.
 *   4. Once backing up can work (the diagnosis is stubbed as ready), "If
 *      backing up keeps failing" holds Test connection, Repair the online
 *      copy, Start over from the online copy and Sign in again, collapsed.
 *   5. A Reader sees no status control, Get latest or Back up now.
 *
 * Screenshots: <os tmpdir>/online-copy-{bar,tab,rename,delete,reader}.png.
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
/** Click a revision row's button by its label. */
const rowButton = (name, label) =>
  evalJs(`(() => {
    const li = [...document.querySelectorAll('.revisions .item-list > li')].find((l) => l.querySelector('.item-label').textContent.trim() === ${JSON.stringify(name)});
    const b = [...(li?.querySelectorAll('.item-actions button') ?? [])].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    b?.click();
    return !!b;
  })()`);
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

// ── 7. the tab: status, this computer, revisions ─────────────────────────────
check(await waitFor(`!!document.querySelector('#project-settings-panel .revisions .item-list li') && !!document.querySelector('#project-settings-panel .this-computer .line')`), "the Revisions list and the line about this computer loaded");
const tab = await evalJs(`(() => {
  const panel = document.querySelector('#project-settings-panel');
  const rows = [...panel.querySelectorAll('.revisions .item-list > li')].map((li) => ({
    name: li.querySelector('.item-label')?.textContent.trim(),
    mine: !!li.querySelector('.mine'),
    where: li.querySelector('.item-caption')?.textContent.trim(),
    actions: [...li.querySelectorAll('.item-actions button')].map((b) => b.textContent.trim()),
  }));
  return {
    headline: panel.querySelector('.headline')?.textContent.trim(),
    line: panel.querySelector('.this-computer .line')?.textContent.trim(),
    buttons: [...panel.querySelectorAll('.this-computer button')].map((b) => b.textContent.trim()),
    rows,
    stale: [...panel.querySelectorAll('.hint')].some((h) => h.textContent.includes("Couldn't check the online copy for other revisions. This list shows the revisions on this computer.")),
    failing: !!panel.querySelector('details.failing'),
    signIn: [...panel.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sign in…'),
  };
})()`);
log(`tab: ${JSON.stringify(tab)}`);
check(/online copy is on GitHub: ada\/harbor-lights\. Sign in to back it up\./.test(tab.headline) && tab.signIn, "the status is one sentence with its one action (Sign in…)");
check(/^Saved · last version /.test(tab.line) && tab.buttons.join("|") === "Save a version|Version history…", `the line about this computer, with Save a version and Version history… (${tab.line})`);
const row = (name) => tab.rows.find((r) => r.name === name);
check(tab.rows.map((r) => r.name).join(",") === "editors-pass,main,release-1,second-edition", "every revision is listed, by name");
check(row("main").mine && row("main").where === "Online · not backed up yet" && row("main").actions.join("|") === "Rename…", "the open revision: You're working on this, where it is, Rename… only");
check(row("second-edition").where === "Only on this computer" && row("second-edition").actions.join("|") === "Switch|Rename…|Delete…", "a revision only on this computer: Switch, Rename…, Delete…");
check(row("release-1").where === "Online" && row("release-1").actions.join("|") === "Switch|Rename…|Delete…", "an online revision: Switch, Rename…, Delete…");
check(row("editors-pass").where === "Only online" && row("editors-pass").actions.join("|") === "Switch", "an online-only revision: Switch only");
check(tab.stale, "an online copy that could not be checked says the list shows this computer's revisions");
check(!tab.failing, "the failing-tools disclosure is only there once backing up can work");
await screenshot(join(tmpdir(), "online-copy-tab.png"));

// ── 8. New revision… ─────────────────────────────────────────────────────────
await click("#project-settings-panel .revisions button", "New revision…");
await type(".revisions input", "Third edition");
await sleep(100);
const preview = await evalJs(`document.querySelector('.revisions .name-form .hint')?.textContent.trim()`);
check(preview === 'It will be called "Third-edition".', `the field previews the name (${preview})`);
const note = await evalJs(`document.querySelector('.revisions .inline-form')?.textContent.replace(/\\s+/g, ' ')`);
check(note.includes("starts from your book as it is now") && note.includes("goes online the next time you back up"), "a one-line note says what it does");
await click(".revisions button", "Create revision");
check(await waitFor(`[...document.querySelectorAll('.revisions .item-label')].some((e) => e.textContent.trim() === 'Third-edition')`), "the new revision is listed");
const created = await evalJs(`window.__revisions.calls.find((c) => c.path === 'create-revision')?.body`);
check(created?.name === "Third edition", "the typed name went to the host (it normalises it)");
check(await evalJs(`!!document.querySelector('.revisions .item-list li:has(.mine) .item-label') && document.querySelector('.revisions .item-list li:has(.mine) .item-label').textContent.trim() === 'Third-edition'`), "the new revision is the one open");

// ── 9. Rename… of an online revision ─────────────────────────────────────────
check(await rowButton("main", "Rename…"), "Rename… on the online revision");
await type(".revisions .name-form input", "first edition");
await sleep(100);
const renameNote = await evalJs(`document.querySelector('.revisions .inline-form')?.textContent.replace(/\\s+/g, ' ')`);
check(renameNote.includes('This also renames it in the online copy. Anyone else working on "main" keeps the old name until they switch to "first-edition".'), "an online rename says it renames online too");
await screenshot(join(tmpdir(), "online-copy-rename.png"));
await click(".revisions .name-form button", "Rename");
check(await waitFor(`[...document.querySelectorAll('.revisions .item-label')].some((e) => e.textContent.trim() === 'first-edition')`), "the revision is renamed");

// ── 10. Delete… ──────────────────────────────────────────────────────────────
await rowButton("release-1", "Delete…");
const online = await evalJs(`[...document.querySelectorAll('.revisions .inline-form button')].map((b) => b.textContent.trim()).join('|')`);
check(online === "Delete on this computer only|Delete everywhere|Cancel", `an online revision offers this computer only, or everywhere (${online})`);
await click(".revisions .inline-form button", "Delete everywhere");
check(await waitFor(`![...document.querySelectorAll('.revisions .item-label')].some((e) => e.textContent.trim() === 'release-1')`), "deleted everywhere");
check(await evalJs(`window.__revisions.calls.some((c) => c.path === 'delete-revision' && c.body.name === 'release-1' && c.body.everywhere === true)`), "the host was asked to delete it everywhere");

await rowButton("second-edition", "Delete…");
await click(".revisions .inline-form button", "Delete");
check(await waitFor(`/2 versions/.test(document.querySelector('.revisions .inline-form .warn')?.textContent ?? '')`), "a revision holding versions found nowhere else asks again, naming how many");
await screenshot(join(tmpdir(), "online-copy-delete.png"));
await click(".revisions .inline-form button", "Delete anyway");
check(await waitFor(`![...document.querySelectorAll('.revisions .item-label')].some((e) => e.textContent.trim() === 'second-edition')`), "deleted after the second confirmation");
check(await evalJs(`window.__revisions.calls.filter((c) => c.path === 'delete-revision' && c.body.name === 'second-edition').map((c) => !!c.body.discard).join() === 'false,true'`), "the second call carried discard: true");

// ── 11. Switch ───────────────────────────────────────────────────────────────
await rowButton("editors-pass", "Switch");
check(await waitFor(`document.querySelector('.revisions .item-list li:has(.mine) .item-label')?.textContent.trim() === 'editors-pass'`), "Switch opens an online-only revision");

// ── 12. once backing up can work: the tools for when it keeps failing ────────
const closeDialog = () => evalJs(`document.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
await closeDialog();
check(await waitFor(`!document.querySelector('#project-settings-panel')`), "Book setup closed");
await evalJs(`window.__diagnoseReady = true; true`);
await click(".status-bar .status-control");
check(await waitFor(`!!document.querySelector('#project-settings-panel details.failing')`), "the failing-tools disclosure is there once backing up can work");
const failing = await evalJs(`(() => {
  const d = document.querySelector('#project-settings-panel details.failing');
  return {
    open: d.open,
    summary: d.querySelector('summary').textContent.trim(),
    buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()),
    headline: document.querySelector('#project-settings-panel .headline')?.textContent.trim(),
  };
})()`);
log(`ready tab: ${JSON.stringify(failing)}`);
check(!failing.open && failing.summary === "If backing up keeps failing", "it is collapsed by default");
check(failing.buttons.join("|") === "Test connection|Repair the online copy|Start over from the online copy|Sign in again", "it holds the four tools");
check(/^Online copy: github\.com\/ada\/harbor-lights$/.test(failing.headline), `the status names the online copy without claiming a backup (${failing.headline})`);
await closeDialog();
check(await waitFor(`!document.querySelector('#project-settings-panel')`), "Book setup closed again");

// ── 13. a Reader sees none of it ─────────────────────────────────────────────
await click('.status-bar button[aria-label="Settings"]');
check(await waitFor(`!!document.querySelector('input[name="settings-role"][value="reader"]')`), "Settings opened");
await click('input[name="settings-role"][value="reader"]');
await evalJs(`document.querySelector('input[name="settings-role"][value="reader"]').dispatchEvent(new Event('change', { bubbles: true })); true`);
await closeDialog();
check(await waitFor(`!document.querySelector('input[name="settings-role"]')`), "Settings closed");
check(await waitFor(`!document.querySelector('.status-bar .status-control')`), "a Reader has no status control");
const readerBar = await evalJs(`[...document.querySelectorAll('.status-bar button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())`);
check(!readerBar.some((l) => /Get latest|Back up now/.test(l)), `a Reader has no Get latest or Back up now (${readerBar.join(", ")})`);
await screenshot(join(tmpdir(), "online-copy-reader.png"));

log("PASS: one status control, the Online copy tab, revisions (new, rename, delete, switch) and the Reader's bare status bar all verified");
cleanup();
process.exit(0);
