#!/usr/bin/env node
/**
 * Reproduces, and bounds, the `@page { background: url() }` defect
 * (issue #152, `docs/known-limitations.md` §3) in ONE command:
 *
 *   node tools/page-background-repro.mjs
 *
 * It answers three questions with measurements, not opinions:
 *
 *   1. Does the defect reproduce?  A `url()` whose only reference in the
 *      document is inside an `@page` rule is not painted into the PDF.
 *   2. What are its boundaries?    A `data:` URI is immune; any second
 *      reference fixes it; a margin box's own image fails the same way.
 *   3. WHY?                        The image is not requested during document
 *      load at all. The request is issued when printing starts — because
 *      that is when `@page` style is first resolved — and the print paints
 *      the page box without waiting for it. A SECOND print of the same,
 *      unmodified document paints, because by then the resource is complete.
 *
 * CONTROLS. Four cases MUST paint. If any of them measures as dropped, the
 * harness is broken and the run is void — it does not mean "everything
 * reproduces". Issue #152 was misdiagnosed for months by a harness that
 * returned "dropped" for every cell, including the case that works; the
 * control gate below exists so that cannot happen silently again.
 *
 * EXIT CODES
 *   0  the defect reproduces and every control passes — status quo
 *   1  a control failed: the harness or the environment is wrong, not Chromium
 *   2  every control passed and the defect did NOT reproduce — a hint that
 *      Chromium may have fixed it. NOT the removal trigger, and not wired into
 *      CI. This script prints with `--virtual-time-budget=15000` (line ~244),
 *      which RECOMMENDATION.md §2 measures as outcome-changing: its
 *      `page-url-img` control expects an `<img>` reference to PAINT, which is
 *      true here and FALSE on the product's print path. The authoritative
 *      trigger is behavioural, in the suite, on the product's own path:
 *      `packages/cli/src/engine/compiler/page-background-chromium-bug.canary.test.ts`
 *      (see `docs/known-limitations.md` §3 and RECOMMENDATION.md §6).
 *      Confirm any exit 2 there before deleting anything.
 *
 * REQUIREMENTS: `google-chrome` (or `$CHROMIUM_PATH`), `pdftoppm` (poppler),
 * and node >= 22 / bun (for the WebSocket global the CDP leg uses). No npm
 * dependencies: the test tile is generated, the PDF is measured by parsing
 * pdftoppm's binary PGM, and CDP is spoken over the built-in WebSocket.
 *
 * MEASUREMENT. Primary signal is the mean absolute per-pixel difference
 * against the SAME document with the `url()` removed — so `0.0000` is proof
 * the declaration changed nothing (docs/filing-upstream-chromium-bugs.md,
 * "Measure differentially"). The left-margin strip std-dev is reported
 * beside it: the `@page` background paints into the margin, where body
 * content never reaches, and a flat colour there reads 0.00.
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const CHROME = process.env.CHROMIUM_PATH || "google-chrome";
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "gp-pagebg-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// A generated PNG tile. Generated, not committed, for one reason: a fixture
// file in the repo can pick up a second reference from anything else that
// touches it, and a document with a second reference passes REGARDLESS of the
// bug. That is exactly how this went unnoticed.
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

function png(width, height, pixel) {
  const crc32 = (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 8x8 checkerboard, scale-invariant so any tile size looks the same once CSS scales it. */
const TILE = png(64, 64, (x, y) => (((x >> 3) + (y >> 3)) % 2 === 0 ? [20, 20, 20] : [225, 225, 225]));
const TILE_DATA_URI = `data:image/png;base64,${TILE.toString("base64")}`;
fs.writeFileSync(path.join(WORK, "tile.png"), TILE);

// ---------------------------------------------------------------------------
// Measurement: parse pdftoppm's binary PGM. No image library needed.
// ---------------------------------------------------------------------------

function rasterize(pdfPath, tag) {
  execFileSync("pdftoppm", ["-gray", "-r", "100", "-f", "1", "-l", "1", pdfPath, path.join(WORK, tag)]);
  const f = fs.readdirSync(WORK).find((n) => n.startsWith(`${tag}-`) && n.endsWith(".pgm"));
  const buf = fs.readFileSync(path.join(WORK, f));
  let pos = 0;
  const token = () => {
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x23) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; continue; }
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { pos++; continue; }
      break;
    }
    const s = pos;
    while (pos < buf.length && ![0x20, 0x09, 0x0a, 0x0d].includes(buf[pos])) pos++;
    return buf.toString("latin1", s, pos);
  };
  if (token() !== "P5") throw new Error("pdftoppm did not produce a binary PGM");
  const width = Number(token()), height = Number(token());
  token();
  pos++;
  return { width, height, data: buf.subarray(pos, pos + width * height) };
}

/** Mean absolute per-pixel difference. 0.0000 => the declaration changed nothing. */
function diff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

/** Population std-dev of a strip inside the left page margin. Flat colour => 0.00. */
function marginStdev(img) {
  let n = 0, sum = 0, sq = 0;
  for (let y = 30; y < img.height - 30; y++) {
    for (let x = 8; x < 40; x++) {
      const v = img.data[y * img.width + x];
      n++; sum += v; sq += v * v;
    }
  }
  const mean = sum / n;
  return Math.sqrt(sq / n - mean * mean);
}

// ---------------------------------------------------------------------------
// The documents. 5x3in, 0.5in margins, so the left margin is a 50px-wide strip
// at 100dpi that body content can never reach.
// ---------------------------------------------------------------------------

const doc = ({ pageBg = "", marginBox = "", head = "", body = "" }) =>
  `<!doctype html><html><head><meta charset="utf-8">${head}
<style>
@page {
  size: 5in 3in; margin: 0.5in;
  background: #c9c5be${pageBg}; background-size: 0.5in auto;
  @top-center { content: "x"; width: 2in; height: 0.4in;${marginBox} }
}
body { margin: 0; font: 10pt sans-serif; }
</style></head><body><p>content</p>${body}</body></html>`;

const url = ' url("tile.png") repeat';
const dataUrl = ` url("${TILE_DATA_URI}") repeat`;

/**
 * Each case is measured against its OWN control — the identical document with
 * only the image reference removed — so nothing depends on comparing unlike
 * documents.
 */
const CASES = [
  {
    id: "page-url-alone",
    label: "@page url(), the ONLY reference   [what Gutterpress emits >512 KB]",
    expect: "drop",
    subject: doc({ pageBg: url }),
    control: doc({}),
  },
  {
    id: "page-url-preload",
    label: "  + <link rel=preload as=image> for the same url",
    expect: "paint",
    control_role: "CONTROL",
    subject: doc({ pageBg: url, head: '<link rel="preload" as="image" href="tile.png">' }),
    control: doc({ head: '<link rel="preload" as="image" href="tile.png">' }),
  },
  {
    id: "page-url-img",
    label: "  + a 1x1 opacity:0 <img> for the same url",
    expect: "paint",
    control_role: "CONTROL",
    subject: doc({ pageBg: url, body: '<img src="tile.png" style="position:absolute;width:1px;height:1px;opacity:0">' }),
    control: doc({ body: '<img src="tile.png" style="position:absolute;width:1px;height:1px;opacity:0">' }),
  },
  {
    id: "page-data-alone",
    label: "@page data: URI, the ONLY reference [what Gutterpress emits <=512 KB]",
    expect: "paint",
    control_role: "CONTROL",
    subject: doc({ pageBg: dataUrl }),
    control: doc({}),
  },
  {
    id: "marginbox-url-alone",
    label: "margin box background-image url(), only reference",
    expect: "drop",
    subject: doc({ marginBox: ' background-image: url("tile.png");' }),
    control: doc({ marginBox: "" }),
  },
  {
    id: "marginbox-url-preload",
    label: "  + <link rel=preload as=image> for the same url",
    expect: "paint",
    control_role: "CONTROL",
    subject: doc({ marginBox: ' background-image: url("tile.png");', head: '<link rel="preload" as="image" href="tile.png">' }),
    control: doc({ marginBox: "", head: '<link rel="preload" as="image" href="tile.png">' }),
  },
];

function printToPdf(html, tag) {
  const htmlPath = path.join(WORK, `${tag}.html`);
  const pdfPath = path.join(WORK, `${tag}.pdf`);
  fs.writeFileSync(htmlPath, html);
  execFileSync(
    CHROME,
    [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--virtual-time-budget=15000", "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
    ],
    { stdio: "ignore", timeout: 180_000 },
  );
  return rasterize(pdfPath, tag);
}

// ---------------------------------------------------------------------------
// A minimal CDP client, for the two facts a single `--print-to-pdf` cannot
// show: WHEN the image is requested, and what a SECOND print does.
// ---------------------------------------------------------------------------

async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gp-pagebg-profile-"));
  const proc = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0",
     `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for (let i = 0; i < 300 && port === null; i++) {
      if (fs.existsSync(portFile)) {
        const first = fs.readFileSync(portFile, "utf8").split("\n")[0]?.trim();
        if (first) port = Number(first);
      }
      if (port === null) await sleep(100);
    }
    if (port === null) throw new Error("Chrome did not publish a DevTools port");
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    let id = 1;
    const pending = new Map();
    const events = new Set();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else for (const l of events) l(m);
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const n = id++;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    const waitFor = (method, sessionId) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => { events.delete(l); reject(new Error(`timeout: ${method}`)); }, 30_000);
        const l = (m) => {
          if (m.method === method && (!sessionId || m.sessionId === sessionId)) {
            clearTimeout(t); events.delete(l); resolve(m.params);
          }
        };
        events.add(l);
      });
    return await fn({ send, waitFor });
  } finally {
    proc.kill("SIGKILL");
    await sleep(200);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

const PRINT_OPTS = {
  printBackground: true, preferCSSPageSize: true,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
};

async function timingLeg() {
  const log = [];
  let t0 = Date.now();
  const pages = new Map([
    ["/alone.html", doc({ pageBg: ' url("/tile.png") repeat' })],
    ["/preload.html", doc({ pageBg: ' url("/tile.png") repeat', head: '<link rel="preload" as="image" href="/tile.png">' })],
  ]);
  const server = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    log.push({ t: Date.now() - t0, u });
    if (u === "/tile.png") {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      res.end(TILE);
      return;
    }
    const body = pages.get(u);
    if (body === undefined) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await withChrome(async ({ send, waitFor }) => {
      const out = {};
      for (const name of ["alone", "preload"]) {
        const { targetId } = await send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
        await send("Page.enable", {}, sessionId);
        log.length = 0;
        t0 = Date.now();
        const loaded = waitFor("Page.loadEventFired", sessionId);
        await send("Page.navigate", { url: `${origin}/${name}.html` }, sessionId);
        await loaded;
        await sleep(2500); // idle: nothing pending, nothing to wait out
        const requestedBeforePrint = log.some((e) => e.u === "/tile.png");
        const printCalledAt = Date.now() - t0;
        const first = await send("Page.printToPDF", PRINT_OPTS, sessionId);
        const tileAt = log.find((e) => e.u === "/tile.png")?.t ?? null;
        fs.writeFileSync(path.join(WORK, `cdp-${name}-1.pdf`), Buffer.from(first.data, "base64"));
        await sleep(1500); // let the request the PRINT started actually finish
        const second = await send("Page.printToPDF", PRINT_OPTS, sessionId);
        fs.writeFileSync(path.join(WORK, `cdp-${name}-2.pdf`), Buffer.from(second.data, "base64"));
        out[name] = {
          requestedBeforePrint,
          printCalledAt,
          tileAt,
          requests: log.filter((e) => e.u !== "/favicon.ico").map((e) => `${e.t}ms ${e.u}`),
          print1: marginStdev(rasterize(path.join(WORK, `cdp-${name}-1.pdf`), `cdp-${name}-1`)),
          print2: marginStdev(rasterize(path.join(WORK, `cdp-${name}-2.pdf`), `cdp-${name}-2`)),
        };
        await send("Target.closeTarget", { targetId });
      }
      return out;
    });
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------

function chromeVersion() {
  try { return execFileSync(CHROME, ["--version"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}

const PAINT_THRESHOLD = 1.0; // mean-abs-diff; a painted tile measures ~90

async function main() {
  if (typeof globalThis.WebSocket !== "function") {
    console.error("This script needs a WebSocket global: run it with node >= 22 or bun.");
    process.exit(1);
  }
  console.log(`@page background repro — ${chromeVersion()}`);
  console.log(`issue #152 · docs/known-limitations.md §3 · work dir ${WORK}\n`);

  console.log("PART 1 — does the declaration change the printed page at all?");
  console.log("  measured differentially against the identical document with the image reference removed\n");
  console.log("    mean-abs-diff  margin-sd  result   expected  case");

  const failures = [];
  let defectReproduced = null;
  for (const c of CASES) {
    const a = printToPdf(c.subject, `${c.id}-s`);
    const b = printToPdf(c.control, `${c.id}-c`);
    const d = diff(a, b);
    const painted = d > PAINT_THRESHOLD;
    const got = painted ? "PAINTS " : "DROPPED";
    const want = c.expect === "paint" ? "PAINTS " : "DROPPED";
    const ok = got === want;
    const mark = c.control_role === "CONTROL" ? "control" : "      ";
    console.log(
      `    ${d.toFixed(4).padStart(13)}  ${marginStdev(a).toFixed(2).padStart(9)}  ${got}  ${want}  ${mark} ${c.label}`,
    );
    if (c.control_role === "CONTROL" && !ok) failures.push(c);
    if (c.id === "page-url-alone") defectReproduced = !painted;
  }

  if (failures.length) {
    console.log(`\n  HARNESS BROKEN — ${failures.length} control(s) that must paint did not:`);
    for (const c of failures) console.log(`    · ${c.label.trim()}`);
    console.log("  A run where the known-good cases also measure as dropped proves nothing about");
    console.log("  Chromium. Fix the harness or the environment; do not record these numbers.");
    process.exit(1);
  }

  console.log("\nPART 2 — when is the image requested, and what does a SECOND print do?");
  console.log("  served over HTTP so every request is timestamped; the page is left idle 2.5s");
  console.log("  after load, so nothing is merely 'still loading' when the print begins.\n");
  const timing = await timingLeg();
  for (const [name, t] of Object.entries(timing)) {
    console.log(`  ${name}.html`);
    console.log(`    requests            : ${t.requests.join(" | ")}`);
    console.log(`    tile requested before the print began? ${t.requestedBeforePrint ? "yes" : "NO"}`);
    console.log(`    print #1 called at ${t.printCalledAt}ms, tile requested at ${t.tileAt === null ? "never" : `${t.tileAt}ms`}`);
    console.log(`    print #1 margin-sd=${t.print1.toFixed(2)}  ${t.print1 > PAINT_THRESHOLD ? "PAINTS" : "DROPPED"}`);
    console.log(`    print #2 margin-sd=${t.print2.toFixed(2)}  ${t.print2 > PAINT_THRESHOLD ? "PAINTS" : "DROPPED"}\n`);
  }

  const alone = timing.alone;
  const printTriggeredFetch = !alone.requestedBeforePrint && alone.tileAt !== null;
  const secondPrintPaints = alone.print2 > PAINT_THRESHOLD && alone.print1 <= PAINT_THRESHOLD;

  console.log("SUMMARY");
  console.log(`  defect reproduces (sole @page url() is dropped) : ${defectReproduced ? "yes" : "no"}`);
  console.log(`  fetch is started BY the print, not by the load  : ${printTriggeredFetch ? "yes" : "no"}`);
  console.log(`  a second print of the same document paints      : ${secondPrintPaints ? "yes" : "no"}`);

  if (!defectReproduced) {
    console.log("\n  REMOVAL TRIGGER MET. Every control passed and Chromium painted an image");
    console.log("  referenced only from an @page rule. Delete the workarounds, the");
    console.log("  engine.page-background.unreferenced warning, and known-limitations.md §3.");
    process.exit(2);
  }
  console.log("\n  Status quo: the defect is live on this Chromium. Nothing to change.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
