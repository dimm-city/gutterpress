#!/usr/bin/env node
/**
 * ADVISORY perf gate: preview RE-RENDER latency (GitHub issue #107, v1).
 *
 * Sibling of render-gate.mjs. Where render-gate measures paged.js layout
 * THROUGHPUT (pages/sec) to catch the hidden-iframe throttle and HARD-FAILS,
 * this script measures how long a warm PREVIEW RE-RENDER takes for a fixed
 * ~50-page project (bench/novel-50p) and is ADVISORY ONLY — it never exits
 * non-zero. It prints the measured ms, the ratio vs the committed baseline
 * (bench/perf-baseline.json), and the ≤300ms contract target, and emits GitHub
 * workflow annotations (::notice:: / ::warning::) so a regression surfaces on
 * the PR without turning the check red.
 *
 * What it does:
 *   1. Copies the committed fixture bench/novel-50p to a throwaway temp dir
 *      (so the viewer's git-init / auto-snapshot writes never touch the tree).
 *   2. Launches the BUILT viewer (`electron out/main/main.js`) with
 *      --remote-debugging-port, a throwaway HOME, and xvfb-run when no DISPLAY.
 *      Run `npm run build && npm run electron:build` FIRST.
 *   3. Opens the temp project and waits for the INITIAL layout to finish.
 *   4. WARM RE-RENDER LOOP: rewrites a chapter .md (the file watcher picks it
 *      up exactly like an author's auto-save), then times the render window —
 *      from when layout goes active to when the page counter reappears. Takes
 *      the median over several iterations (first is a discarded warm-up).
 *
 * Metric definition: we time the RENDER-ACTIVE window (layout start → layout
 * complete), which excludes the OS watcher debounce so the number reflects the
 * pagination cost itself — the thing the ≤300ms contract targets — and stays
 * reproducible across machines.
 *
 * Baseline refresh (deliberate, maintainer-only): run
 *   npm run rerender-baseline      # -> node rerender-latency-gate.mjs --write-baseline
 * locally, review, and COMMIT the updated bench/perf-baseline.json. CI never
 * writes the baseline.
 *
 * Usage:
 *   node tests/perf/rerender-latency-gate.mjs [--iterations <n>] [--write-baseline]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, "..", "..");
const require_ = createRequire(join(viewerDir, "package.json"));

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : dflt;
}
const ITERATIONS = Math.max(2, Number(arg("--iterations", 5))); // incl. 1 warm-up
const WRITE_BASELINE = process.argv.includes("--write-baseline");
const TARGET_MS = 300; // ≤300ms contract target (issue #107) — advisory
const WARN_RATIO = 1.5; // annotate ::warning:: when measured > this * baseline
const START_CAP_S = 180; // initial layout must finish within this
const RENDER_ACTIVE_CAP_S = 60; // a single re-render must complete within this
const PORT = 9000 + Math.floor(Math.random() * 800);

const FIXTURE_SRC = join(here, "bench", "novel-50p");
const BASELINE_PATH = join(here, "bench", "perf-baseline.json");

const log = (m) => console.log(`[rerender-gate] ${m}`);
const childOutput = [];
let lastCdpList = null;
// Hoisted so cleanup()/bail() are safe even when we skip before spawning.
let cleaned = false;
let child = null;
let fakeHome = null;
let workRoot = null;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { if (child?.pid) process.kill(-child.pid, "SIGTERM"); } catch {}
  try { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  try { if (workRoot) rmSync(workRoot, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ADVISORY: this gate never fails the build. `bail` logs, emits a ::warning::
// annotation, cleans up, and exits 0 so an environment problem (no built app,
// no CDP, headless flakiness) degrades to "no measurement", not a red check.
const bail = (m) => {
  console.error(`[rerender-gate] SKIP: ${m}`);
  console.log(`::warning title=Re-render latency::skipped — ${m}`);
  if (lastCdpList !== null) console.error(`[rerender-gate] last CDP /json/list: ${JSON.stringify(lastCdpList)}`);
  if (childOutput.length) {
    console.error(`[rerender-gate] --- captured app stdout/stderr (last ${childOutput.length} chunk(s)) ---`);
    for (const chunk of childOutput) process.stderr.write(chunk);
    console.error(`\n[rerender-gate] --- end app output ---`);
  }
  cleanup();
  process.exit(0);
};

// ── 0. baseline ──────────────────────────────────────────────────────────────
let baseline = null;
if (existsSync(BASELINE_PATH)) {
  try {
    const b = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))?.["novel-50p"] ?? null;
    // A placeholder baseline (rerenderMs<=0 / measuredAt "pending") is treated
    // as "no baseline yet" so the ratio reads n/a instead of Infinity.
    baseline = b && Number(b.rerenderMs) > 0 ? b : null;
  } catch (e) {
    log(`could not parse baseline (${e.message}) — continuing without it`);
  }
}

// ── 1. copy fixture to a throwaway dir ───────────────────────────────────────
if (!existsSync(join(FIXTURE_SRC, "manifest.yaml"))) bail(`fixture missing at ${FIXTURE_SRC}`);
workRoot = mkdtempSync(join(tmpdir(), "rerender-gate-work-"));
const projectDir = join(workRoot, "novel-50p");
cpSync(FIXTURE_SRC, projectDir, { recursive: true });
// Do not carry the generator into the opened project.
try { rmSync(join(projectDir, "generate.mjs"), { force: true }); } catch {}
const chapterToPoke = join(projectDir, "01-chapter.md");
const chapterBase = readFileSync(chapterToPoke, "utf8").replace(/\n<!-- rerender-tick \d+ -->\n?$/, "");
log(`fixture copied to: ${projectDir}`);

// ── 2. launch the built app ─────────────────────────────────────────────────
const mainJs = join(viewerDir, "out", "main", "main.js");
if (!existsSync(mainJs)) bail(`no ${mainJs} — run \`npm run build && npm run electron:build\` first`);
let electronBin;
try {
  electronBin = require_("electron"); // path to the electron binary
} catch (e) {
  // Advisory gate: a missing/uninstalled Electron binary must degrade to a
  // skip (exit 0), never a red check.
  bail(`electron binary unavailable (${e.message.split("\n")[0]})`);
}

fakeHome = mkdtempSync(join(tmpdir(), "rerender-gate-home-"));
const useXvfb = !process.env.DISPLAY;
const argv = [mainJs, `--remote-debugging-port=${PORT}`, "--no-sandbox"];
const cmd = useXvfb ? "xvfb-run" : electronBin;
const cmdArgs = useXvfb ? ["-a", electronBin, ...argv] : argv;
log(`launching: ${cmd} ${cmdArgs.join(" ")} (HOME=${fakeHome}${useXvfb ? ", via xvfb-run" : `, DISPLAY=${process.env.DISPLAY}`})`);

child = spawn(cmd, cmdArgs, {
  cwd: viewerDir,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: fakeHome,
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    XDG_CACHE_HOME: join(fakeHome, ".cache"),
    XDG_DATA_HOME: join(fakeHome, ".local", "share"),
  },
});
const bufferChunk = (d) => { childOutput.push(d.toString()); if (childOutput.length > 300) childOutput.shift(); };
child.stdout.on("data", bufferChunk);
child.stderr.on("data", bufferChunk);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 3. CDP attach ───────────────────────────────────────────────────────────
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      lastCdpList = list;
      const page = list.find((t) => t.type === "page" && String(t.url).startsWith("app://"));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  bail("CDP endpoint / app:// page target never appeared (60s)");
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
await send("Page.bringToFront");

// ── 4. open the fixture via the left-panel Projects tab ──────────────────────
let spaReady = false;
for (let i = 0; i < 60; i++) {
  if (await evalJs(`!!document.querySelector('button[aria-label="Toggle left panel"]')`)) { spaReady = true; break; }
  await sleep(1000);
}
if (!spaReady) bail("SPA never became interactive (left panel toggle not found in 60s)");

let panelReady = false;
for (let i = 0; i < 20; i++) {
  if (await evalJs(`!!document.querySelector('.projects-body .location-input')`)) { panelReady = true; break; }
  await sleep(500);
}
if (!panelReady) {
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
  set.call(inp, ${JSON.stringify(projectDir)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
log("projects panel driven; waiting for initial layout to finish…");

// Same DOM signals as render-gate: the "Laying out page" overlay text plus the
// page select's data-total-pages seam (AppToolbar.svelte) — a select's option
// text never appears in innerText, so the old "Page X / Y" pill scrape is gone.
const layoutActive = () =>
  evalJs(`/Laying out page \\d+|Rendering(\\u2026|\\.\\.\\.| complete)/.test(document.body.innerText)`);
const finishedInfo = () =>
  evalJs(`(() => {
    if (/Laying out page \\d+|Rendering(\\u2026|\\.\\.\\.| complete)/.test(document.body.innerText)) return null;
    const sel = document.querySelector("select.page-select");
    if (!sel || sel.disabled) return null;
    const total = Number(sel.dataset.totalPages || 0);
    return total > 0 ? total : null;
  })()`);

async function waitFinished(capMs, label) {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    const total = await finishedInfo();
    if (total != null) return total;
    await sleep(100);
  }
  bail(`${label} did not finish within ${(capMs / 1000).toFixed(0)}s`);
}

// ── 5. initial render ────────────────────────────────────────────────────────
const totalPages = await waitFinished(START_CAP_S * 1000, "initial layout");
log(`initial layout finished: ${totalPages} pages`);

// ── 6. warm re-render loop ───────────────────────────────────────────────────
// Each iteration rewrites 01-chapter.md (author auto-save analogue). The folder
// watcher (150ms debounce) notifies the renderer, which re-runs pagination. We
// time the render-active window: layout-active -> counter-reappears.
const samples = [];
for (let it = 0; it < ITERATIONS; it++) {
  await waitFinished(RENDER_ACTIVE_CAP_S * 1000, `pre-iteration ${it}`);
  // trigger: change file content (unique marker each time so the watcher fires)
  writeFileSync(chapterToPoke, `${chapterBase}\n<!-- rerender-tick ${it} -->\n`);

  // wait for the render to go active
  let activeStart = null;
  const activeDeadline = Date.now() + 8000;
  while (Date.now() < activeDeadline) {
    if (await layoutActive()) { activeStart = Date.now(); break; }
    await sleep(10);
  }
  if (activeStart == null) {
    log(`iteration ${it}: render window not observed (completed faster than sampling) — skipping`);
    continue;
  }
  // wait for it to finish
  let end = null;
  const finDeadline = activeStart + RENDER_ACTIVE_CAP_S * 1000;
  while (Date.now() < finDeadline) {
    if (!(await layoutActive()) && (await finishedInfo()) != null) { end = Date.now(); break; }
    await sleep(10);
  }
  if (end == null) { log(`iteration ${it}: render did not complete within cap — skipping`); continue; }
  const ms = end - activeStart;
  const warm = it === 0 ? " (warm-up, discarded)" : "";
  log(`iteration ${it}: re-render ${ms}ms${warm}`);
  if (it > 0) samples.push(ms);
}

// restore the chapter so nothing lingers (temp copy is deleted anyway)
try { writeFileSync(chapterToPoke, chapterBase); } catch {}

if (samples.length === 0) bail("no re-render samples were collected");

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const min = samples[0];
const max = samples[samples.length - 1];

// ── 7. report + baseline compare ─────────────────────────────────────────────
const baseMs = baseline?.rerenderMs ?? null;
const ratio = baseMs ? median / baseMs : null;
const ratioStr = ratio != null ? `${ratio.toFixed(2)}x` : "n/a (no baseline)";
log(
  `median re-render: ${median}ms (min ${min}ms, max ${max}ms, n=${samples.length}) | ` +
    `baseline ${baseMs != null ? baseMs + "ms" : "none"} | ratio ${ratioStr} | target ≤${TARGET_MS}ms`,
);

if (WRITE_BASELINE) {
  const doc = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
  doc["novel-50p"] = {
    rerenderMs: median,
    measuredAt: new Date().toISOString().slice(0, 10),
    note: `median of ${samples.length} warm re-renders (${min}-${max}ms), ${useXvfb ? "xvfb headless" : "display " + process.env.DISPLAY}, ${totalPages}pp`,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + "\n");
  log(`baseline written: ${BASELINE_PATH} -> ${median}ms`);
}

// GitHub annotations (advisory; never fails the check)
const overTarget = median > TARGET_MS;
const regressed = ratio != null && ratio > WARN_RATIO;
if (regressed) {
  console.log(`::warning title=Re-render latency::${median}ms is ${ratioStr} baseline (${baseMs}ms) — possible regression (target ≤${TARGET_MS}ms)`);
} else if (overTarget) {
  console.log(`::warning title=Re-render latency::${median}ms exceeds ${TARGET_MS}ms contract target (${ratioStr} baseline)`);
} else {
  console.log(`::notice title=Re-render latency::${median}ms (${ratioStr} baseline, target ≤${TARGET_MS}ms)`);
}

cleanup();
process.exit(0); // ADVISORY — always green
