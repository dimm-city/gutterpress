#!/usr/bin/env node
/**
 * Release gate: packaged-app render-speed regression check.
 *
 * Catches the v0.4.1..v0.5.0-rc.3 class of bug where the preview iframe was
 * hidden (opacity:0) during layout. The iframe is CROSS-ORIGIN
 * (http://127.0.0.1 inside app://) and Chromium render-throttles invisible
 * cross-origin iframes to ~1fps — paged.js is rAF-driven, so layout crawled
 * at ~1 page/sec instead of 10-30+. Fix tag: render-fix-iframe-visibility.
 *
 * What it does:
 *   1. Generates (or reuses) the synthetic fixture book (make-fixture-book.mjs).
 *   2. Launches the BUILT viewer (`electron out/main/main.js`) with
 *      --remote-debugging-port, a throwaway HOME, and xvfb-run when no DISPLAY.
 *      Run `npm run build && npm run electron:build` FIRST — the gate only
 *      launches, it does not build.
 *   3. Drives the app over raw CDP: opens the fixture via the Open dialog,
 *      samples the "Laying out page N" counter, computes pages/sec.
 *   4. FAILS (exit 1) if the sampled rate is below MIN_RATE, or layout never
 *      starts / never finishes within the caps.
 *
 * Threshold: healthy ≈ 10-30+ pp/s, the broken state ≈ 1 pp/s. MIN_RATE=4
 * gives margin in both directions.
 *
 * xvfb verdict (measured 2026-06-10): the opacity:0 cross-origin-iframe
 * throttle reproduces IDENTICALLY under xvfb-run and a real display
 * (broken ≈1.0 pp/s both; healthy 20-80+ pp/s both). Chromium keys this
 * throttle off iframe VISIBILITY (no visible pixels), not GPU/display —
 * unlike the window-level `show:false` regression (0.4.1 splash bug), which
 * xvfb canNOT reproduce. So this gate IS CI-viable headless; see
 * .github/workflows/render-perf-gate.yml. Validate any gate change under
 * both modes anyway.
 *
 * Usage:  node tests/perf/render-gate.mjs [--sample <s>] [--min-rate <pp/s>]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { generateFixtureBook } from "./make-fixture-book.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, "..", "..");
const require_ = createRequire(join(viewerDir, "package.json"));

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SAMPLE_S = Number(arg("--sample", 20)); // rate-measurement window
const MIN_RATE = Number(arg("--min-rate", 4)); // pp/s — healthy ≈10-30+, broken ≈1
const START_CAP_S = 120; // layout must BEGIN within this
const FINISH_CAP_S = 300; // layout must END within this (generous)
const PORT = 9000 + Math.floor(Math.random() * 800);

const log = (m) => console.log(`[render-gate] ${m}`);
// Diagnostic buffers dumped on failure. The launched app's own stdout/stderr is
// otherwise swallowed (see the drain handlers below), and the CDP target list is
// never surfaced — so a startup crash/hang reads as an opaque "never appeared".
// Capturing both makes CI failures debuggable without changing any pass/fail
// criterion.
const childOutput = [];
let lastCdpList = null;
const fail = (m) => {
  console.error(`[render-gate] FAIL: ${m}`);
  if (lastCdpList !== null) {
    console.error(`[render-gate] last CDP /json/list: ${JSON.stringify(lastCdpList)}`);
  }
  if (childOutput.length) {
    console.error(`[render-gate] --- captured app stdout/stderr (last ${childOutput.length} chunk(s)) ---`);
    for (const chunk of childOutput) process.stderr.write(chunk);
    console.error(`\n[render-gate] --- end app output ---`);
  } else {
    console.error(`[render-gate] (no app stdout/stderr was captured before failure)`);
  }
  cleanup();
  process.exit(1);
};

// ── 1. fixture ──────────────────────────────────────────────────────────────
const book = generateFixtureBook();
log(`fixture book: ${book}`);

// ── 2. launch the built app ─────────────────────────────────────────────────
const mainJs = join(viewerDir, "out", "main", "main.js");
if (!existsSync(mainJs)) fail(`no ${mainJs} — run \`npm run build && npm run electron:build\` first`);
const electronBin = require_("electron"); // path to the electron binary

const fakeHome = mkdtempSync(join(tmpdir(), "render-gate-home-"));
const useXvfb = !process.env.DISPLAY;
const argv = [mainJs, `--remote-debugging-port=${PORT}`, "--no-sandbox"];
const cmd = useXvfb ? "xvfb-run" : electronBin;
const cmdArgs = useXvfb ? ["-a", electronBin, ...argv] : argv;
log(`launching: ${cmd} ${cmdArgs.join(" ")} (HOME=${fakeHome}${useXvfb ? ", via xvfb-run" : `, DISPLAY=${process.env.DISPLAY}`})`);

const child = spawn(cmd, cmdArgs, {
  cwd: viewerDir,
  detached: true, // own process group so we can kill electron + xvfb together
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: fakeHome,
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    XDG_CACHE_HOME: join(fakeHome, ".cache"),
    XDG_DATA_HOME: join(fakeHome, ".local", "share"),
  },
});
// Buffer (not discard) the app's output so fail() can dump it — bounded so a
// chatty app can't grow this unboundedly.
const bufferChunk = (d) => {
  childOutput.push(d.toString());
  if (childOutput.length > 300) childOutput.shift();
};
child.stdout.on("data", bufferChunk);
child.stderr.on("data", bufferChunk);
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  // throwaway HOME created by this script via mkdtemp — safe to remove
  try { rmSync(fakeHome, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 3. CDP attach ───────────────────────────────────────────────────────────
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      lastCdpList = list; // remember the most recent target list for failure diagnostics
      const page = list.find((t) => t.type === "page" && String(t.url).startsWith("app://"));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  fail("CDP endpoint / app:// page target never appeared (60s)");
}

const ws = new WebSocket(await getWsUrl());
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
  return r.result?.result?.value;
}

// An occluded/unfocused window gets render-throttled by Chromium and would
// contaminate the measurement — bring it to the front.
await send("Page.bringToFront");

// ── 4. open the fixture book via the left panel Projects tab ─────────────
// The workspace restructure removed the standalone Open button. The left panel
// auto-opens on the Projects tab when no project is loaded.
let spaReady = false;
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!document.querySelector('button[aria-label="Toggle left panel"]')`)) { spaReady = true; break; }
  await sleep(1000);
}
if (!spaReady) fail("SPA never became interactive (left panel toggle not found in 60s)");

// Wait for the Projects tab to auto-open
let panelReady = false;
for (let i = 0; i < 20; i++) {
  const hasInput = await evalJs(`!!document.querySelector('.projects-body .location-input')`);
  if (hasInput) { panelReady = true; break; }
  await sleep(500);
}
if (!panelReady) {
  // Manually open panel and switch to Projects tab
  await evalJs(`document.querySelector('button[aria-label="Toggle left panel"]').click(); true`);
  await sleep(500);
  await evalJs(`(() => {
    const tabs = [...document.querySelectorAll('.panel-tab')];
    const t = tabs.find(b => b.textContent.trim().toUpperCase().includes('PROJECTS'));
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
  set.call(inp, ${JSON.stringify(book)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
log("projects panel driven; waiting for layout to start…");

const layoutPage = () => evalJs(`(document.body.innerText.match(/Laying out page (\\d+)/) || [])[1] ?? null`);
// Completion signal: the toolbar's page indicator is a native <select>
// (AppToolbar.svelte) whose option text never appears in innerText — read its
// data-total-pages seam instead (enabled = render finished, totalPages > 0).
const finishedInfo = () =>
  evalJs(`(() => {
    if (/Laying out page \\d+/.test(document.body.innerText)) return null;
    const sel = document.querySelector("select.page-select");
    if (!sel || sel.disabled) return null;
    const total = Number(sel.dataset.totalPages || 0);
    return total > 0 ? total : null;
  })()`);

// ── 5. wait for layout to begin (or finish before we catch it) ─────────────
let p0 = null;
const startDeadline = Date.now() + START_CAP_S * 1000;
while (Date.now() < startDeadline) {
  const v = await layoutPage();
  if (v != null) { p0 = Number(v); break; }
  const done = await finishedInfo();
  if (done != null) {
    log(`PASS: render completed before sampling could start (${done} pages) — faster than measurable`);
    cleanup();
    process.exit(0);
  }
  await sleep(500);
}
if (p0 == null) fail(`layout never started within ${START_CAP_S}s`);

// ── 6. sample the rate ──────────────────────────────────────────────────────
const t0 = Date.now();
log(`layout started at page ${p0}; sampling for up to ${SAMPLE_S}s…`);
let rate = null;
let verdictNote = "";
const finishDeadline = t0 + FINISH_CAP_S * 1000;
let sampledRateChecked = false;

while (Date.now() < finishDeadline) {
  await sleep(1000);
  const v = await layoutPage();
  const dt = (Date.now() - t0) / 1000;
  if (v == null) {
    // layout text gone — finished (or transitioning); confirm total
    const total = await finishedInfo();
    if (total != null) {
      rate = (total - p0) / dt;
      verdictNote = `finished during sample: total=${total} p0=${p0} dt=${dt.toFixed(1)}s (rate is a lower bound)`;
      break;
    }
    continue; // brief transition state; keep polling
  }
  if (!sampledRateChecked && dt >= SAMPLE_S) {
    sampledRateChecked = true;
    rate = (Number(v) - p0) / dt;
    verdictNote = `sampled: p0=${p0} p1=${v} dt=${dt.toFixed(1)}s`;
    if (rate < MIN_RATE) break; // broken — no point waiting for the cap
    // healthy so far — keep waiting for completion within the cap
  }
}

if (rate == null) fail(`layout did not finish within ${FINISH_CAP_S}s and rate could not be sampled`);
log(`measured render rate: ${rate.toFixed(2)} pages/sec (${verdictNote}) — threshold ${MIN_RATE} pp/s`);

if (rate < MIN_RATE) fail(`render rate ${rate.toFixed(2)} pp/s is below threshold ${MIN_RATE} pp/s — this is the hidden-iframe throttle signature (see tag render-fix-iframe-visibility)`);

// if we broke out via finish we're done; otherwise ensure it actually finishes
if (!verdictNote.startsWith("finished")) {
  let total = null;
  while (Date.now() < finishDeadline) {
    total = await finishedInfo();
    if (total != null) break;
    await sleep(1000);
  }
  if (total == null) fail(`rate was healthy (${rate.toFixed(2)} pp/s) but layout never finished within ${FINISH_CAP_S}s`);
  log(`layout finished: ${total} pages total`);
}

log(`PASS: ${rate.toFixed(2)} pp/s >= ${MIN_RATE} pp/s`);
cleanup();
process.exit(0);
