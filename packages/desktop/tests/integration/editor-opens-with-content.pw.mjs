#!/usr/bin/env node
/**
 * Regression drive for four editing-navigation defects reported by the product
 * owner against 0.10.2. Each check reproduced a real failure before its fix:
 *
 *   1. Opening a book while the workspace is ALREADY in Edit mode left the
 *      editor pane stuck on "Loading editor…" forever. The project-open
 *      pipeline called `ensureEditorFile()` (filling the buffer) but never
 *      `loadEditorModule()`, so the lazy CodeMirror chunk was never imported.
 *      Only the *toggle* path called it — which is why
 *      editor-toggle-loads-module.pw.mjs stayed green through the bug.
 *
 *   2. A single click on source-mapped content in the viewer did nothing to the
 *      editor. The book already emits `elementActivated` and it already reached
 *      the host, but `PreviewEventController.handleEvent`'s switch had no case
 *      for it, so the event was dropped.
 *
 *   3. Clicking a TOC row in Edit mode moved the viewer but not the editor.
 *      Same root cause as (1): `jumpToOutline` DID call `revealInEditor`, but
 *      with no editor mounted `whenEditorReady` spun for 120 frames and gave up.
 *
 *   4. The TOC's collapse control was dead on any ancestor of the active
 *      heading: `tocOpen()` OR-ed the user's expansion set with the
 *      force-revealed active ancestors, so clicking "Collapse X" could never
 *      win against the second operand.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DRIVE USED TO FLAKE (~5-15% of CI runs), and what was ruled out
 * ---------------------------------------------------------------------------
 * The symptom was always the CONTROL below:
 *
 *   CONTROL: the render never settled in 90s
 *     — {"overlay":"Rendering…","viewerPages":2}
 *
 * i.e. the BOOK had paginated (its own page count is 2) while the host still
 * had a render scrim over it. For an author that is a permanent "Rendering…"
 * scrim over a finished book, a page count stuck at 0, and a Problems panel
 * that never re-lints — so it was worth chasing rather than muting.
 *
 * ROOT CAUSE: these CDP drives leaked their Electron app. `cleanup()` sent
 * SIGTERM to the detached process group, which Chromium does not reliably die
 * on — it starts a graceful shutdown that outlives this script. Measured: one
 * passing local run left one live Electron behind, and a 10-run CI leg ended
 * with exactly 10 orphan Electrons in the job's "Terminate orphan process"
 * sweep. Every leaked instance kept competing for the runner's cores, so the
 * failure rate climbed with how many launches the job had already done:
 *
 *   stuck scrim, runs 1-5 of a leg :  2/95  (2.1%)
 *   stuck scrim, runs 6-10 of a leg: 10/95 (10.5%)     z = 2.39
 *
 *   (runs 1 and 2 of a leg: 0 failures in 19 attempts each)
 *
 * That is also why the flake looked worst here: the CI behaviour job runs five
 * drives back to back and this one is LAST, so it inherited four leaked apps.
 * The fix is in `cleanup()` below — SIGKILL, which cannot be caught.
 *
 * RULED OUT, with evidence — do not re-derive these:
 *
 *   1. The host attach gate. `PreviewClient` drops messages until `attach()`
 *      names a window, and `PreviewFrame` used to attach on the iframe's
 *      `load`. That IS a real defect (instrumented: `ready` lost in 8/8 runs,
 *      `renderingComplete` clearing attach by as little as 0ms) and was fixed
 *      separately — but closing it did NOT move the rate: 6/70 stuck before
 *      vs 4/80 after, z = 0.87. It only changed the overlay LABEL, because the
 *      host then heard `pageChanged` and showed "Laying out page 2…" instead.
 *   2. preview-shell.js's `active === hotReloadFrame` suppression of
 *      `ready`/`renderingComplete`. Instrumented across two forced hot
 *      reloads, every suppressed completion was paired with a
 *      `reportSwapComplete()` in the SAME millisecond. Never orphaned.
 *   3. A second `renderingComplete` after frame promotion (from a zoom or
 *      view-mode change). Impossible: `gp:layout` — the only thing that
 *      produces `renderingComplete` — is dispatched in exactly one place,
 *      inside the viewer's `mount()`, so a document emits it once.
 *   4. The shell dropping messages from the `building` replacement frame.
 *      Instrumented on failing CI runs: no such drop occurred.
 *   5. `renderingCancelled`. It has ONE emitter, preview-shell.js's swap
 *      `onReady` timeout, whose `timeoutMs` defaults to 180000 — it cannot
 *      have fired inside this drive's 90s budget, and no failing trace
 *      contained one. (Separately: the host's `renderingCancelled` handler
 *      clears the "Updating preview…" pill but NOT `lifecycle.rendering`,
 *      unlike `handleCancelRender()` which clears both. That is a real latent
 *      bug — it would strand the scrim permanently after a 180s swap timeout —
 *      but it is NOT this flake and is tracked on its own.)
 *
 * The instrumented traces from failing runs showed the host receiving almost
 * nothing (one showed an empty message log and a `getTotalPages` that never
 * answered at all) — the signature of a starved renderer, not a lost event.
 *
 * Usage:
 *   node tests/integration/editor-opens-with-content.pw.mjs [exe-or-main-js] [fixture-dir]
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
const PORT = 9600 + Math.floor(Math.random() * 250);

const log = (m) => console.log(`[editor-opens] ${m}`);
let child = null;
let fakeHome = null;
let bookDir = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  // SIGKILL, not SIGTERM: Electron does not reliably die on SIGTERM — Chromium
  // begins a graceful shutdown that outlives this script, so the app survives the
  // run. Measured on CI, a 10-run leg left exactly 10 orphan Electrons, and every
  // leaked instance kept competing for the runner (see the diagnosis in
  // editor-opens-with-content.pw.mjs's header). SIGKILL cannot be caught, so the
  // process group actually ends.
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child?.kill("SIGKILL"); } catch {} }
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  try { if (bookDir) rmSync(bookDir, { recursive: true, force: true }); } catch {}
}
const fail = (m) => {
  console.error(`[editor-opens] FAIL: ${m}`);
  cleanup();
  process.exit(1);
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 1. fixture copy ──────────────────────────────────────────────────────────
const [, , exeArg, fixtureArg] = process.argv;
const srcFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(srcFixture)) fail(`fixture not found: ${srcFixture}`);
bookDir = mkdtempSync(join(tmpdir(), "gutterpress-editoropens-"));
cpSync(srcFixture, bookDir, { recursive: true });
log(`fixture: ${bookDir}`);

// ── 2. launch, with Edit mode ALREADY selected before the book opens ─────────
const target = exeArg ? resolve(exeArg) : join(desktopDir, "out", "main", "main.js");
if (!existsSync(target)) fail(`no ${target} — run \`npm run build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const electronBin = isMainJs ? require_("electron") : target;
const appArgv = [...(isMainJs ? [target] : []), `--remote-debugging-port=${PORT}`, "--no-sandbox"];

fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-editoropens-home-"));
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: true, activeTab: "toc", width: 300 } }),
);
// `preview.mode: "editor"` is the whole point: the workspace is in Edit mode
// BEFORE any book is open, which is the state the toggle path never reaches.
writeFileSync(
  join(userDataDir, "app-settings.json"),
  JSON.stringify({ settingsSchemaVersion: 2, preview: { mode: "editor" } }),
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
    await sleep(400);
  }
  if (label) fail(`${label} (waited ${ms}ms for: ${expr})`);
  return false;
}
/** Poll without failing — for assertions that record rather than abort. */
async function poll(expr, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evalJs(expr)) return true;
    await sleep(400);
  }
  return false;
}
/** Poll until `expr` evaluates to something non-null, and return it. */
async function pollValue(expr, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await evalJs(expr);
    if (v != null) return v;
    await sleep(500);
  }
  return null;
}
// Checks RECORD rather than abort, so one run against a broken build shows
// every defect that is still present instead of only the first.
const failures = [];
const check = (ok, msg) => {
  if (ok) log(`ok   — ${msg}`);
  else { failures.push(msg); console.error(`[editor-opens] FAIL — ${msg}`); }
  return ok;
};
await send("Page.bringToFront");

// ── 4. SPA + project ready ───────────────────────────────────────────────────
await waitFor(`!!document.querySelector('button[aria-label="Edit"]')`, 60000, "SPA never became interactive");
log("SPA ready");
await waitFor(
  `!!(document.querySelector('.toc-item') || document.querySelector('.file-item'))`,
  120000,
  "project never opened",
);
await evalJs(`document.querySelector('button[aria-label="Close this screen"]')?.click(); true`);
for (let i = 0; i < 20; i++) {
  if (!(await evalJs(`!!document.querySelector('.app-root[inert]')`))) break;
  await sleep(50);
}
if (await evalJs(`!!document.querySelector('.app-root[inert]')`)) {
  fail("welcome layer did not release the workspace");
}
log("project opened");

// CONTROL — the app really is in Edit mode with the pane rendered. If either of
// these fails the harness is wrong (bad settings key), not the product.
if (await evalJs(`document.querySelector('button[aria-label="Edit"]')?.getAttribute('aria-pressed')`) !== "true") {
  fail("CONTROL: workspace is not in Edit mode — the preview.mode setting did not apply");
}
if (!(await evalJs(`!!document.querySelector('.editor-pane')`))) {
  fail("CONTROL: no .editor-pane rendered in Edit mode");
}
log("CONTROL ok: Edit mode active, editor pane rendered");

// A direct line to the book's own command bridge. Used to move the VIEWER
// without going through any host navigation path, so the only thing that can
// move the editor during CHECK 2 is the click itself.
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

// ── CHECK 1 — the editor loads its module AND the first chapter's content ────
const cmMounted = await poll(`!!document.querySelector('.cm-editor')`, 25000);
check(cmMounted,
  'DEFECT 1: opening a book in Edit mode must mount CodeMirror — pane stayed on "Loading editor…"');
const cmHasContent = cmMounted &&
  await poll(`(document.querySelector('.cm-content')?.textContent ?? '').includes('Alpha')`, 15000);
check(cmHasContent,
  "DEFECT 1: the editor must open showing the book's first chapter");
if (cmMounted && await evalJs(`[...document.querySelectorAll('.editor-loading')].some(e => e.textContent.includes('Loading editor'))`)) {
  check(false, '"Loading editor…" still visible alongside .cm-editor');
}

// ── CHECK 2 — a single click on viewer content reveals it in the editor ─────
// Park the viewer on a block belonging to a DIFFERENT source file than the one
// the editor shows, so "loads that content into the editor" is binary.
//
// Finding that block is anchored on the OUTLINE, not on frame geometry. An
// earlier version read `getTotalPages()` once and grid-scanned fractions of the
// iframe: on a slower CI machine pagination had not reached page 2 when the
// count was read, so the scan loop never ran at all and the control tripped.
// The outline is authoritative about which chapters exist, `scrollTo` puts the
// target on screen, and `queryDom` reports where it actually landed — so the
// only thing left to geometry is a horizontal sweep along one known y.
let clickTarget = null;
let targetDiag = { stage: "editor never loaded" };
if (cmHasContent) {
  // 0. Let the render SETTLE before measuring anything. Coordinates taken
  //    while the book is still paginating do not survive to the click:
  //    reproduced under CPU load, the band below came back at y=82 instead of
  //    the settled y=66, the layout moved 0.8s later, and the click landed on
  //    the wrong block — CHECK 2 went red for a reason it does not test.
  //    This also puts the wait where its budget makes sense. It used to sit
  //    AFTER the measuring below, with 30s, and the measuring had already
  //    burned ~14s of the render by then; the overlay is up for the WHOLE
  //    initial pagination, which the gates above budget 90-120s for.
  //    The overlay's own label says which half is still running, so a stalled
  //    pagination and a stalled post-render reveal no longer look alike.
  if (!(await poll(`!document.querySelector('.loading-overlay')`, 90000))) {
    // Ask the BOOK how many pages it has, not the host. The two answers
    // disagree exactly when the host never heard the frame's renderingComplete:
    // a paginated book under a stuck "Rendering…" scrim is an event the host
    // lost, which no budget here can wait out, while zero pages is pagination
    // that genuinely never finished.
    const stuck = await evalJs(`(async () => ({
      overlay: document.querySelector('.loading-overlay .label')?.textContent?.trim() ?? null,
      viewerPages: await window.__ask('getTotalPages', []),
    }))()`);
    fail(`CONTROL: the render never settled in 90s — ${JSON.stringify(stuck)}`);
  }
  // 1. Wait for pagination to actually reach a second chapter. Keyed on the
  //    outline's own content, not on a fixed sleep.
  const secondChapter = await pollValue(
    `(async () => {
       const outline = await window.__ask('getOutline', []);
       const hit = (outline ?? []).find(e => e.chapter && e.chapter !== '01-alpha.md' && e.sourceLine != null);
       return hit ? { chapter: hit.chapter, line: hit.sourceLine, text: hit.text } : null;
     })()`,
    90000,
  );
  targetDiag = { stage: "outline", secondChapter };

  if (secondChapter) {
    // 2. Bring it on screen (same reason inline-editing.pw.mjs scrolls before
    //    reading a box: absolute click coords are only meaningful in view).
    await evalJs(
      `window.__ask('scrollTo', [{ line: ${secondChapter.line}, chapter: ${JSON.stringify(secondChapter.chapter)} }, { block: 'start' }])`,
    );
    // 3. Wait for a block of that chapter to be genuinely inside the frame,
    //    and take its measured y from the viewer rather than guessing.
    // Filter on the viewer's OWN `chapter` field rather than a selector:
    // `data-chapter-src` sits on each block element itself, not on a wrapper,
    // so a descendant selector matches nothing. Asking the viewer which chapter
    // a block belongs to is placement-independent and cannot drift.
    const band = await pollValue(
      `(async () => {
         const f = document.querySelector('iframe');
         const h = f.getBoundingClientRect().height;
         const rows = await window.__ask('queryDom', [{
           selector: '[data-source-line]',
           fields: ['chapter', 'rectTop', 'tag', 'sourceLine'],
         }]);
         const hit = (rows ?? []).find(r =>
           r.chapter === ${JSON.stringify(secondChapter.chapter)} && r.rectTop > 4 && r.rectTop < h - 60);
         return hit ? { y: Math.round(hit.rectTop + 6), tag: hit.tag, frameH: Math.round(h) } : null;
       })()`,
      30000,
    );
    // Record the layout too: below NARROW_BREAKPOINT (820) the workspace shows
    // ONE pane, so in Edit mode the book is not on screen to be clicked at all.
    // Without this, a stacked layout and a genuinely missing block both look
    // like `band: null`.
    const layout = await evalJs(`(() => {
      const f = document.querySelector('iframe');
      const r = f ? f.getBoundingClientRect() : null;
      const ws = document.querySelector('.workspace');
      return {
        win: { w: window.innerWidth, h: window.innerHeight },
        frame: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        narrow: !!ws?.classList.contains('narrow'),
        showEdit: !!ws?.classList.contains('show-edit'),
      };
    })()`);
    targetDiag = { ...targetDiag, stage: "band", band, layout };

    if (band) {
      // 4. One horizontal sweep at that y — the page may be narrower than the
      //    frame and centred, so sweep the full width rather than assume it.
      clickTarget = await evalJs(`(async () => {
        const f = document.querySelector('iframe');
        const r = f.getBoundingClientRect();
        const tried = [];
        for (const dy of [0, 10, 22, -8]) {
          for (let fx = 0.08; fx <= 0.94; fx += 0.045) {
            const x = Math.round(r.width * fx), y = ${band.y} + dy;
            if (y < 2 || y > r.height - 2) continue;
            const t = await window.__ask('getContextTargetAt', [{ x, y }]);
            if (t && t.kind && t.kind !== 'none' && t.rect &&
                t.chapter === ${JSON.stringify(secondChapter.chapter)}) {
              return { chapter: t.chapter, rect: t.rect, frame: { left: r.left, top: r.top }, at: { x, y } };
            }
            if (tried.length < 8) tried.push({ x, y, kind: t && t.kind, ch: t && t.chapter });
          }
        }
        return { __miss: true, tried, frame: { w: Math.round(r.width), h: Math.round(r.height) } };
      })()`);
      if (clickTarget && clickTarget.__miss) {
        targetDiag = { ...targetDiag, stage: "sweep", sweep: clickTarget };
        clickTarget = null;
      }
    }
  }
}
if (!cmHasContent) {
  check(false, "DEFECT 2: not evaluable — the editor never loaded (see CHECK 1)");
} else if (!clickTarget) {
  // Deliberately a hard failure, not a skip: a click assertion that passes when
  // its target was never reachable is not an assertion.
  fail(
    `CONTROL: no source-mapped block from a second chapter was reachable in the viewer — ${JSON.stringify(targetDiag)}`,
  );
} else {
  const before = await evalJs(`document.querySelector('.cm-content')?.textContent?.slice(0, 60) ?? ''`);
  const cx = Math.round(clickTarget.frame.left + clickTarget.rect.left + Math.min(40, clickTarget.rect.width / 2));
  const cy = Math.round(clickTarget.frame.top + clickTarget.rect.top + Math.min(10, clickTarget.rect.height / 2));
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: cx, y: cy });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: cx, y: cy });
  const marker = clickTarget.chapter.replace(/^\d+-|\.md$/g, "");
  const moved = await poll(
    `(document.querySelector('.cm-content')?.textContent ?? '').toLowerCase().includes(${JSON.stringify(marker.toLowerCase())})`,
    10000,
  );
  check(moved,
    `DEFECT 2: a single click on content from ${clickTarget.chapter} must load that file into the editor (it still showed "${before.slice(0, 34)}…")`);
}
// ── CHECK 3 — a TOC click navigates BOTH panes ──────────────────────────────
await evalJs(`document.querySelector('#panel-tab-toc')?.click(); true`);
await waitFor(`document.querySelectorAll('.toc-item').length > 0`, 20000, "CONTROL: TOC tab never listed any headings");
const tocPick = await evalJs(`(() => {
  const cur = document.querySelector('.cm-content')?.textContent ?? '';
  const items = [...document.querySelectorAll('.toc-item')];
  const wanted = cur.includes('Gamma') ? 'Beta' : 'Gamma';
  const hit = items.find(b => b.textContent.includes(wanted));
  return hit ? { text: hit.textContent.trim(), wanted } : null;
})()`);
if (!tocPick) fail("CONTROL: no TOC row for a second chapter");
// Measure the viewer by the target heading's own position in the frame.
// `getVisibleSource()` is NOT a usable proxy here: this fixture is two pages and
// one scroll position shows blocks from both, so it can report the far page
// while the viewer has demonstrably scrolled.
const headingId = await evalJs(`(async () => {
  const outline = await window.__ask('getOutline', []);
  const hit = (outline ?? []).find(e => e.text.includes(${JSON.stringify(tocPick.wanted)}) && e.id);
  return hit ? hit.id : null;
})()`);
const rectTopOf = async (id) => id == null ? null : await evalJs(
  `(async () => {
     const r = await window.__ask('queryDom', [{ selector: '#' + ${JSON.stringify(id)}, fields: ['rectTop'] }]);
     return r && r[0] ? r[0].rectTop : null;
   })()`,
);
const headingTopBefore = await rectTopOf(headingId);
await evalJs(`(() => {
  [...document.querySelectorAll('.toc-item')].find(b => b.textContent.includes(${JSON.stringify(tocPick.wanted)})).click();
  return true;
})()`);
const tocMovedEditor = await poll(
  `(document.querySelector('.cm-content')?.textContent ?? '').includes(${JSON.stringify(tocPick.wanted)})`,
  10000,
);
check(tocMovedEditor,
  `DEFECT 3: clicking the TOC row "${tocPick.text}" in Edit mode must navigate the EDITOR, not just the viewer`);
// The preview scroll is a separate async round-trip from the editor reveal, so
// poll for it rather than sampling once. "Moved" means the clicked heading is
// now parked at the top of the frame.
if (headingId == null) {
  log("note — no anchored heading for the picked TOC row; viewer half not measurable in this book");
} else {
  await poll(
    `(async () => {
       const r = await window.__ask('queryDom', [{ selector: '#' + ${JSON.stringify(headingId)}, fields: ['rectTop'] }]);
       return r && r[0] && Math.abs(r[0].rectTop) < 250;
     })()`,
    10000,
  );
  const headingTopAfter = await rectTopOf(headingId);
  check(
    headingTopAfter != null && Math.abs(headingTopAfter) < 250 && headingTopAfter !== headingTopBefore,
    `DEFECT 3: the same TOC click must also move the VIEWER — "${tocPick.wanted}" heading rectTop ${headingTopBefore} -> ${headingTopAfter} (expected it scrolled near the frame top)`,
  );
}

// ── CHECK 4 — the TOC collapse control works on the ACTIVE branch ───────────
// Select a nested heading so its parent becomes a force-revealed ancestor, then
// demand that the parent's own "Collapse" button actually collapses it.
// The expandable-row handle is the .toc-item BUTTON, not the <li>: the rows are
// a plain nested list (no treeitem role), and aria-expanded lives on the button
// because that is the element focus lands on and the element the arrow keys act
// on -- i.e. the state this reads is the state a screen reader is told.
const parentName = await evalJs(`(() => {
  const btn = document.querySelector('.toc-list .toc-item[aria-expanded]');
  const li = btn?.closest('li');
  if (!li) return null;
  const tw = li.querySelector(':scope > .toc-row > .toc-twisty');
  if (btn.getAttribute('aria-expanded') === 'false') tw.click();
  return li.querySelector(':scope > .toc-row > .toc-item > .toc-text')?.textContent ?? null;
})()`);
if (!parentName) fail("CONTROL: no expandable TOC row in this book");
await sleep(800);
const childName = await evalJs(`(() => {
  const li = document.querySelector('.toc-list .toc-item[aria-expanded]')?.closest('li');
  const child = li?.querySelector(':scope > ul.nested > li > .toc-row > .toc-item');
  if (!child) return null;
  child.click();
  return child.querySelector('.toc-text')?.textContent ?? null;
})()`);
if (!childName) fail("CONTROL: expandable TOC row rendered no children to select");
await sleep(2500);

const readParent = () => evalJs(`(() => {
  const li = [...document.querySelectorAll('.toc-list li')]
    .find(l => (l.querySelector(':scope > .toc-row > .toc-item > .toc-text')?.textContent ?? '') === ${JSON.stringify(parentName)});
  const btn = li?.querySelector(':scope > .toc-row > .toc-item');
  return li ? { exp: btn?.getAttribute('aria-expanded'), kids: !!li.querySelector(':scope > ul.nested') } : null;
})()`);
const parentBefore = await readParent();
if (parentBefore?.exp !== "true") {
  fail(`CONTROL: selecting "${childName}" did not leave "${parentName}" revealed (got ${JSON.stringify(parentBefore)})`);
}
await evalJs(`(() => {
  const li = [...document.querySelectorAll('.toc-list li')]
    .find(l => (l.querySelector(':scope > .toc-row > .toc-item > .toc-text')?.textContent ?? '') === ${JSON.stringify(parentName)});
  li.querySelector(':scope > .toc-row > .toc-twisty').click();
  return true;
})()`);
await sleep(1000);
const parentAfter = await readParent();
check(
  parentAfter?.exp === "false" && !parentAfter?.kids,
  `DEFECT 4: "Collapse ${parentName}" must work while that branch holds the active heading — aria-expanded/children stayed ${JSON.stringify(parentAfter)}`,
);

// Re-expanding must still work, so the fix cannot have simply pinned it shut.
await evalJs(`(() => {
  const li = [...document.querySelectorAll('.toc-list li')]
    .find(l => (l.querySelector(':scope > .toc-row > .toc-item > .toc-text')?.textContent ?? '') === ${JSON.stringify(parentName)});
  li.querySelector(':scope > .toc-row > .toc-twisty').click();
  return true;
})()`);
await sleep(800);
check((await readParent())?.exp === "true", `re-expanding "${parentName}" after a manual collapse must still work`);

// ── verdict ──────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`[editor-opens] ${failures.length} check(s) failed:`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
  cleanup();
  process.exit(1);
}
log("PASS — all checks green");
cleanup();
process.exit(0);
