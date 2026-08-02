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
 *      (so the desktop's git-init / auto-snapshot writes never touch the tree).
 *   2. Launches the BUILT desktop (`electron out/main/main.js`) with
 *      --remote-debugging-port, a throwaway HOME, and xvfb-run when no DISPLAY.
 *      Run `npm run build && npm run electron:build` FIRST.
 *   3. Opens the temp project and waits for the INITIAL layout to finish.
 *   4. WARM RE-RENDER LOOP: rewrites a chapter through the desktop write route
 *      (the same settled-write handoff as editor save), then measures both write →
 *      visible replacement and the browser-side pagination/swap suffix reported
 *      by the preview shell. Takes the median over several iterations (first is
 *      a discarded warm-up).
 *
 * Primary metric: fixture write → atomic replacement reveal. The shell's own
 * full-reload receipt → reveal duration is retained as a diagnostic, so the
 * difference exposes watcher/debounce/server-side regeneration time.
 *
 * Baseline refresh (deliberate, maintainer-only): run
 *   npm run rerender-baseline      # -> node rerender-latency-gate.mjs --write-baseline
 * locally, review, and COMMIT the updated bench/perf-baseline.json. CI never
 * writes the baseline.
 *
 * Usage:
 *   node tests/perf/rerender-latency-gate.mjs [--iterations <n>] [--write-baseline]
 *     [--fixture <project>] [--chapter <file>]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, cpSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));

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

const fixtureArg = arg("--fixture", "");
const FIXTURE_SRC = fixtureArg ? resolve(fixtureArg) : join(here, "bench", "novel-50p");
const FIXTURE_NAME = basename(FIXTURE_SRC);
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
    const b = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))?.[FIXTURE_NAME] ?? null;
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
const projectDir = join(workRoot, FIXTURE_NAME);
cpSync(FIXTURE_SRC, projectDir, { recursive: true });
// Do not carry the generator into the opened project.
try { rmSync(join(projectDir, "generate.mjs"), { force: true }); } catch {}
const chapterName = arg("--chapter", "") || readdirSync(projectDir).sort().find((name) => name.endsWith(".md") && name !== "README.md");
if (!chapterName) bail(`fixture has no markdown chapter under ${projectDir}`);
const chapterToPoke = join(projectDir, chapterName);
const chapterBase = readFileSync(chapterToPoke, "utf8").replace(/\n<!-- rerender-tick \d+ -->\n?$/, "");
log(`fixture copied to: ${projectDir}`);

// ── 2. launch the built app ─────────────────────────────────────────────────
const mainJs = join(desktopDir, "out", "main", "main.js");
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
  cwd: desktopDir,
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

// Same completion seam as render-gate for the initial open. Hot reloads do not
// mount loading chrome; their timing comes from Page frame events below.
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

await evalJs(`(() => {
  window.__gutterpressHotReloadProbe = null;
  if (window.__gutterpressHotReloadProbeInstalled) return;
  window.__gutterpressHotReloadProbeInstalled = true;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.type === 'gutterpress:event' && data.name === 'renderingComplete' && data.detail?.hotReload === true) {
      const probe = window.__gutterpressHotReloadProbe;
      if (probe && typeof probe.startedAt === 'number') {
        probe.result = {
          writeToVisibleMs: performance.now() - probe.startedAt,
          hotReloadMs: Number(data.detail.hotReloadMs),
        };
      }
    }
  });
})()`);

// ── 6. warm re-render loop ───────────────────────────────────────────────────
// Each iteration uses the same host route as editor save. The route's completed
// write notifies preview directly, avoiding watcher settling and debounce.
const samples = [];
const hotReloadSamples = [];
const preShellSamples = [];
for (let it = 0; it < ITERATIONS; it++) {
  await waitFinished(RENDER_ACTIVE_CAP_S * 1000, `pre-iteration ${it}`);
  const nextContent = `${chapterBase}\n<!-- rerender-tick ${it} -->\n`;
  const writeResult = await evalJs(`(async () => {
    window.__gutterpressHotReloadProbe = { startedAt: performance.now(), result: null };
    const response = await fetch('/api/fs/write-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: ${JSON.stringify(chapterToPoke)}, content: ${JSON.stringify(nextContent)} }),
    });
    return { ok: response.ok, status: response.status, body: response.ok ? '' : await response.text() };
  })()`);
  if (!writeResult?.ok) bail(`desktop write route failed (${writeResult?.status}): ${writeResult?.body}`);

  const finDeadline = Date.now() + RENDER_ACTIVE_CAP_S * 1000;
  let result = null;
  while (Date.now() < finDeadline) {
    result = await evalJs(`window.__gutterpressHotReloadProbe?.result ?? null`);
    if (Number.isFinite(result?.writeToVisibleMs) && Number.isFinite(result?.hotReloadMs)) break;
    await sleep(10);
  }
  if (!Number.isFinite(result?.writeToVisibleMs) || !Number.isFinite(result?.hotReloadMs)) {
    log(`iteration ${it}: shell hot-reload completion was not observed — skipping`);
    continue;
  }
  const ms = Math.round(result.writeToVisibleMs);
  const hotReloadMs = Math.round(result.hotReloadMs);
  const preShellMs = Math.max(0, ms - hotReloadMs);
  const warm = it === 0 ? " (warm-up, discarded)" : "";
  log(`iteration ${it}: write → visible ${ms}ms (pre-shell ${preShellMs}ms, shell ${hotReloadMs}ms)${warm}`);
  if (it > 0) {
    samples.push(ms);
    hotReloadSamples.push(hotReloadMs);
    preShellSamples.push(preShellMs);
  }
}

// restore the chapter so nothing lingers (temp copy is deleted anyway)
try { writeFileSync(chapterToPoke, chapterBase); } catch {}

if (samples.length === 0) bail("no re-render samples were collected");

samples.sort((a, b) => a - b);
hotReloadSamples.sort((a, b) => a - b);
preShellSamples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const hotReloadMedian = hotReloadSamples[Math.floor(hotReloadSamples.length / 2)];
const preShellMedian = preShellSamples[Math.floor(preShellSamples.length / 2)];
const min = samples[0];
const max = samples[samples.length - 1];

// ── 7. report + baseline compare ─────────────────────────────────────────────
const baseMs = baseline?.rerenderMs ?? null;
const ratio = baseMs ? median / baseMs : null;
const ratioStr = ratio != null ? `${ratio.toFixed(2)}x` : "n/a (no baseline)";
log(
  `median write → visible: ${median}ms (pre-shell ${preShellMedian}ms, shell ${hotReloadMedian}ms; ` +
    `min ${min}ms, max ${max}ms, n=${samples.length}) | ` +
    `baseline ${baseMs != null ? baseMs + "ms" : "none"} | ratio ${ratioStr} | target ≤${TARGET_MS}ms`,
);

if (WRITE_BASELINE) {
  const doc = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
  doc[FIXTURE_NAME] = {
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
