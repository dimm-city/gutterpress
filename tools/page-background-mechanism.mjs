#!/usr/bin/env node
/**
 * The MECHANISM behind the `@page { background: url() }` defect (issue #152),
 * as a runnable experiment. Companion to
 * `docs/analysis/why-page-background-drops.md`.
 *
 *   node tools/page-background-mechanism.mjs            # the full table
 *   node tools/page-background-mechanism.mjs --n 12     # repetitions per cell
 *
 * `tools/page-background-repro.mjs` answers "does the defect reproduce". This
 * answers "why", and in particular it makes the three results that nobody could
 * explain reproducible by someone else:
 *
 *   A  a url() reachable only from @page is requested BY THE PRINT, and the
 *      print neither waits for it nor repaints when it lands;
 *   B  a device-metrics override applied after load defeats an <img> guard,
 *      because CDP's Emulation.setDeviceMetricsOverride wipes Blink's
 *      MemoryCache on the first transition into device emulation;
 *   C  a <link rel=preload> survives that wipe (preloads_ is a strong map the
 *      MemoryCache cannot reach) but is CONSUMED by the first real request for
 *      the same URL — so an <img> of the same URL takes it away.
 *
 * WHY THE HARNESS CONDITIONS ARE PRINTED WITH EVERY ROW. This defect has been
 * misdiagnosed three times by harness artefacts. Four knobs silently change the
 * outcome and every one of them is varied deliberately below:
 *
 *   - a device-metrics override established BEFORE navigation (puppeteer sets
 *     one by default: `defaultViewport` is `{800,600}` and `CdpPage._create`
 *     applies it at page creation) — this IMMUNISES an <img> guard;
 *   - `--virtual-time-budget` (this script passes none) — it makes the print
 *     wait for network quiescence and converts a drop into a paint;
 *   - `file://` vs `http://`, and the response's cache-control;
 *   - how many times the document is printed.
 *
 * CONTROLS. Cells marked (control) MUST come out as stated. A run where they
 * do not is void — that is the exact signature behind #152's earlier wrong
 * diagnoses — and exits 1.
 *
 * REQUIREMENTS: `google-chrome` (or $CHROMIUM_PATH), `pdftoppm` (poppler), and
 * node >= 22 / bun for the global WebSocket. No npm dependencies.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const CHROME = process.env.CHROMIUM_PATH || "google-chrome";
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "gp-pagebg-mech-"));
const N = Number(process.argv[process.argv.indexOf("--n") + 1]) || 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// A generated PNG tile. Generated, not committed: a fixture file in the repo
// can pick up a second reference from anything else that touches it, and a
// document with a second reference passes REGARDLESS of the bug.
// ---------------------------------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function tile(px = 64) {
  const crc32 = (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((px * 3 + 1) * px);
  let o = 0;
  for (let y = 0; y < px; y++) {
    raw[o++] = 0;
    for (let x = 0; x < px; x++) {
      const cell = Math.max(1, px >> 3);
      const on = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2;
      const n = ((x * 2654435761) ^ (y * 40503)) & 0x1f;
      const [r, g, b] = on ? [220 - n, 40 + n, 40] : [40, 80 + n, 210 - n];
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Server. Logs every hit itself, so the browser's account of how many times it
// fetched the tile can be checked against an independent one.
// ---------------------------------------------------------------------------
function startServer({ dir, delayMs = 0, cacheControl = "no-store" }) {
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    hits.push(url);
    const file = path.join(dir, url === "/" ? "index.html" : url.slice(1));
    if (!fs.existsSync(file)) return void res.writeHead(404).end("no");
    if (delayMs && url.endsWith(".png")) await sleep(delayMs);
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      "content-type": url.endsWith(".png") ? "image/png" : "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": url.endsWith(".png") ? cacheControl : "no-store",
    });
    res.end(body);
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        port: srv.address().port,
        hits,
        close: () => new Promise((r) => srv.close(r)),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Raw CDP. Deliberately NOT puppeteer — puppeteer's `defaultViewport` is one of
// the variables under test, and it is the confound behind the disputed result.
// ---------------------------------------------------------------------------
async function launch() {
  const profile = fs.mkdtempSync(path.join(WORK, "prof-"));
  const proc = spawn(
    CHROME,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--font-render-hinting=none",
      "--headless=new",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let buf = "";
  const wsUrl = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("no devtools url:\n" + buf)), 20000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        clearTimeout(to);
        resolve(m[0]);
      }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const version = (await send("Browser.getVersion")).product;
  return {
    version,
    onEvent: (fn) => (listeners.push(fn), () => listeners.splice(listeners.indexOf(fn), 1)),
    async newPage() {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const S = (m, p) => send(m, p, sessionId);
      await S("Page.enable");
      await S("Runtime.enable");
      await S("Network.enable");
      return { sessionId, send: S };
    },
    async close() {
      try {
        await send("Browser.close");
      } catch {}
      try {
        proc.kill("SIGKILL");
      } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture + measurement
// ---------------------------------------------------------------------------
const GUARDS = {
  none: () => "",
  preload: (u) => `<link rel="preload" as="image" href="${u}">`,
  img: (u) => `<img src="${u}" style="display:none" alt="">`,
  "preload+img": (u) =>
    `<link rel="preload" as="image" href="${u}"><img src="${u}" style="display:none" alt="">`,
  "img+preload": (u) =>
    `<img src="${u}" style="display:none" alt=""><link rel="preload" as="image" href="${u}">`,
  elembg: (u) => `<div style="background-image:url(${u});width:1px;height:1px"></div>`,
};

function docHtml({ guard, bg, boxes }) {
  const u = "tile.png";
  const mb = boxes
    ? ["@top-left", "@top-right", "@bottom-center"]
        .map(
          (b) =>
            `@page { ${b} { content:""; ${bg ? `background-image:url(${u});` : ""} width:1in; height:.4in } }`,
        )
        .join("\n  ")
    : "";
  return `<!doctype html><meta charset="utf-8"><title>pagebg</title>
<style>
  @page { size: 5in 3in; margin: .5in; ${bg ? `background: url(${u});` : ""} }
  ${mb}
  html, body { margin:0; padding:0; background:#fff }
  body { font: 12pt/1.4 sans-serif; color:#000 }
</style>
${GUARDS[guard](u)}
<p>Gutterpress @page background mechanism fixture.</p>`;
}

const PRINT_OPTS = {
  printBackground: true,
  preferCSSPageSize: true,
  generateTaggedPDF: true,
  generateDocumentOutline: true,
};
const SHEET = { width: 480, height: 288, deviceScaleFactor: 1, mobile: false };
const READY = `(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()`;

async function once({ guard, bg, boxes = false, preNav = null, steps, scheme, cacheControl, delayMs, prints }) {
  const dir = fs.mkdtempSync(path.join(WORK, "case-"));
  fs.writeFileSync(path.join(dir, "tile.png"), tile());
  fs.writeFileSync(path.join(dir, "index.html"), docHtml({ guard, bg, boxes }));
  let srv = null;
  let base = "file://" + dir + "/";
  if (scheme === "http") {
    srv = await startServer({ dir, delayMs, cacheControl });
    base = `http://127.0.0.1:${srv.port}/`;
  }

  const br = await launch();
  const page = await br.newPage();
  const net = [];
  br.onEvent((m) => {
    if (m.sessionId !== page.sessionId) return;
    if (m.method === "Network.requestWillBeSent" && /tile\.png/.test(m.params.request?.url || ""))
      net.push({ at: Date.now(), initiator: m.params.initiator?.type });
  });

  const t = {};
  if (preNav) await page.send("Emulation.setDeviceMetricsOverride", preNav);
  const loaded = new Promise((r) => {
    const off = br.onEvent((m) => {
      if (m.sessionId === page.sessionId && m.method === "Page.loadEventFired") (off(), r());
    });
  });
  t.nav = Date.now();
  await page.send("Page.navigate", { url: base + "index.html" });
  await loaded;
  t.load = Date.now();
  for (const s of steps) {
    if (s === "dmo") await page.send("Emulation.setDeviceMetricsOverride", SHEET);
    else if (s === "media") await page.send("Emulation.setEmulatedMedia", { media: "print" });
    else if (s === "ready") await page.send("Runtime.evaluate", { expression: READY, awaitPromise: true });
  }
  const pdfs = [];
  for (let i = 0; i < prints; i++) {
    const t0 = Date.now();
    const { data } = await page.send("Page.printToPDF", PRINT_OPTS);
    const f = path.join(dir, `out${i}.pdf`);
    fs.writeFileSync(f, Buffer.from(data, "base64"));
    pdfs.push({ file: f, ms: Date.now() - t0 });
  }
  const serverHits = srv ? srv.hits.filter((u) => u.endsWith(".png")).length : null;
  await br.close();
  if (srv) await srv.close();
  return { dir, net, pdfs, serverHits, version: br.version, loadMs: t.load - t.nav };
}

function raster(pdf, out) {
  execFileSync("pdftoppm", ["-gray", "-r", "40", "-f", "1", "-l", "1", pdf, out]);
  const b = fs.readFileSync(out + "-1.pgm");
  let p = 0;
  const f = [];
  while (f.length < 4) {
    while (b[p] === 0x20 || b[p] === 0x0a || b[p] === 0x0d || b[p] === 0x09) p++;
    if (b[p] === 0x23) {
      while (b[p] !== 0x0a) p++;
      continue;
    }
    const s = p;
    while (b[p] > 0x20) p++;
    f.push(b.toString("ascii", s, p));
  }
  return { w: +f[1], h: +f[2], data: b.subarray(p + 1) };
}

/** One cell: the document, and the SAME document with the @page url() removed. */
async function cellOnce(opts) {
  const a = await once({ ...opts, bg: true });
  const b = await once({ ...opts, bg: false });
  const ra = raster(a.pdfs.at(-1).file, path.join(a.dir, "a"));
  const rb = raster(b.pdfs.at(-1).file, path.join(b.dir, "b"));
  let s = 0;
  const n = Math.min(ra.data.length, rb.data.length);
  for (let i = 0; i < n; i++) s += Math.abs(ra.data[i] - rb.data[i]);
  return { diff: s / n, reqs: a.net.length, serverHits: a.serverHits, printMs: a.pdfs[0].ms, loadMs: a.loadMs, version: a.version };
}

const DEFAULTS = { guard: "none", steps: ["dmo", "media", "ready"], scheme: "http", cacheControl: "no-store", delayMs: 0, prints: 1, preNav: null };
const failures = [];

async function cell(label, opts, expect) {
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(await cellOnce({ ...DEFAULTS, ...opts }));
  const paints = runs.filter((r) => r.diff > 0.5).length;
  const reqs = [...new Set(runs.map((r) => r.reqs))].sort().join("/");
  const verdict = paints === N ? "PAINTS" : paints === 0 ? "DROPPED" : `MIXED ${paints}/${N} paint`;
  const bad = expect && !(expect === "PAINTS" ? paints === N : paints === 0);
  if (bad) failures.push(`${label}: expected ${expect}, got ${verdict}`);
  console.log(
    `  ${label.padEnd(44)} ${verdict.padEnd(15)} tileRequests=${reqs.padEnd(4)} print1=${String(Math.round(runs[0].printMs)).padStart(4)}ms${expect ? `   (control: must be ${expect})` : ""}${bad ? "  <-- CONTROL FAILED" : ""}`,
  );
  return runs;
}

// ---------------------------------------------------------------------------
const probe = await once({ ...DEFAULTS, guard: "none", bg: true });
console.log(`Gutterpress — @page background MECHANISM fixture`);
console.log(`browser: ${probe.version}   driver: raw CDP (no puppeteer)   --virtual-time-budget: NOT PASSED   n=${N} per cell\n`);

console.log(`A. THE DEFECT AND ITS SHAPE   [http, no-store, no pre-nav override, build sequence]`);
await cell("@page url(), sole reference", { guard: "none" }, "DROPPED");
await cell("... printed twice (2nd print paints)", { guard: "none", prints: 2 }, "PAINTS");
await cell("... + <link rel=preload as=image>", { guard: "preload" }, "PAINTS");
await cell("... + element background-image (CSS)", { guard: "elembg" }, "PAINTS");
await cell("page box + 3 margin boxes, no guard", { guard: "none", boxes: true }, "DROPPED");
await cell("page box + 3 margin boxes, one preload", { guard: "preload", boxes: true }, "PAINTS");

console.log(`\nB. THE MEMORY-CACHE WIPE   [same, varying ONLY the device-metrics override]`);
console.log(`   DevToolsEmulator::EnableDeviceEmulation calls MemoryCache::EvictResources()`);
console.log(`   when !device_metrics_enabled_; CDP always sends cache_behavior=kClearCache.`);
await cell("<img> guard, NO override at all", { guard: "img", steps: [] }, "PAINTS");
await cell("<img> guard, override AFTER load", { guard: "img", steps: ["dmo"] }, "DROPPED");
await cell("<img> guard, override BEFORE navigation", { guard: "img", steps: ["dmo"], preNav: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false } }, "PAINTS");
await cell("preload guard, override AFTER load", { guard: "preload", steps: ["dmo"] }, "PAINTS");
await cell("no guard, override BEFORE navigation", { guard: "none", steps: ["dmo"], preNav: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false } }, "DROPPED");

console.log(`\nC. THE COLLISION   [an <img> consumes the preload entry: ResourceFetcher::MatchPreload erases it]`);
console.log(`   Rows 1-3 are the gutterpress build's real state (deterministic, gated).`);
console.log(`   Rows 4-5 are puppeteer's immunised state and are NOT gated: the last row`);
console.log(`   is intermittent over http+no-store only (see the analysis, section 5.3).`);
await cell("preload + <img>, no pre-nav override, file://", { guard: "preload+img", scheme: "file" }, "DROPPED");
await cell("<img> + preload, no pre-nav override, file://", { guard: "img+preload", scheme: "file" }, "DROPPED");
await cell("preload alone,   no pre-nav override, file://", { guard: "preload", scheme: "file" }, "PAINTS");
await cell("preload + <img>, PRE-NAV override, file://", { guard: "preload+img", scheme: "file", preNav: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false } });
await cell("preload + <img>, PRE-NAV override, http no-store", { guard: "preload+img", preNav: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false } });

console.log(`\nD. DOES THE PRINT WAIT?   [tile held 1500 ms server-side, no post-load steps]`);
for (const [label, guard] of [
  ["@page url() only", "none"],
  ["+ <img> (blocks the LOAD event)", "img"],
  ["+ preload (blocks nothing)", "preload"],
]) {
  const r = await once({ ...DEFAULTS, guard, bg: true, steps: [], delayMs: 1500 });
  console.log(`  ${label.padEnd(44)} load=+${String(r.loadMs).padStart(5)}ms  print1=${String(r.pdfs[0].ms).padStart(5)}ms  (a print that waited would be >=1500ms)`);
}

if (failures.length) {
  console.log(`\nHARNESS BROKEN — ${failures.length} control(s) failed. This run is void:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAll controls held. See docs/analysis/why-page-background-drops.md.`);
