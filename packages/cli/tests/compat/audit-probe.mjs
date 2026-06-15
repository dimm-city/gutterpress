/**
 * Cross-browser Paged.js audit probe (issue #46).
 *
 * Loads a running print-md preview server in chromium, firefox, and webkit
 * (Playwright engines), waits for the `renderingComplete` CustomEvent that
 * pagedjs-interface.js dispatches on the preview window, and collects
 * per-engine evidence: page count, console errors, and measurements for each
 * suspect Paged.js feature (named pages, string() running headers, custom
 * properties in @page margin boxes, multi-column, position: running()).
 *
 * Usage:
 *   node audit-probe.mjs --url http://127.0.0.1:4101/ [--engines chromium,firefox,webkit] [--out results.json]
 *
 * The preview server must already be running, e.g.:
 *   bun packages/cli/src/cli.ts preview examples/print-md-user-guide --open false --port 4101
 *
 * Note: `/` serves the preview shell, which hosts book.html in an iframe.
 * The probe finds the frame that actually contains `.pagedjs_pages` (the
 * iframe under the shell, or the main frame when /book.html is loaded
 * directly) and runs all measurements there.
 */

import { chromium, firefox, webkit } from "playwright";
import { writeFileSync } from "node:fs";

const RENDER_TIMEOUT_MS = 180_000;

const ENGINES = { chromium, firefox, webkit };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const url = arg("url");
const engineNames = arg("engines", "chromium,firefox,webkit").split(",");
const outFile = arg("out", null);

if (!url) {
  console.error("Usage: node audit-probe.mjs --url <preview-url> [--engines a,b] [--out file.json]");
  process.exit(1);
}

/** Runs inside the preview frame after renderingComplete. Defensive: every
 * probe reports null when the feature's markup is absent from the project. */
function collectProbes() {
  const r = {};
  const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
  r.pageCount = pages.length;

  // ── Named pages: which pagedjs_<name>_page classes were emitted, and the
  //    measured content-area top inset of each named page (named-page rules
  //    in the probe fixture / examples change margin-top distinctively).
  const namedClasses = new Set();
  for (const p of pages) {
    for (const c of p.classList) {
      const m = c.match(/^pagedjs_(.+)_page$/);
      if (m && !["left", "right", "first", "blank"].includes(m[1])) namedClasses.add(m[1]);
    }
  }
  r.namedPageClasses = Array.from(namedClasses).sort();
  r.namedPageContentTop = {};
  for (const name of namedClasses) {
    const p = document.querySelector(`.pagedjs_page.pagedjs_${CSS.escape(name)}_page`);
    const content = p && p.querySelector(".pagedjs_page_content");
    if (p && content) {
      r.namedPageContentTop[name] =
        Math.round(content.getBoundingClientRect().top - p.getBoundingClientRect().top);
    }
  }
  // Baseline: content top of the first non-named page.
  const plain = pages.find((p) => !Array.from(p.classList).some((c) => /^pagedjs_(.+)_page$/.test(c) && !/^pagedjs_(left|right|first|blank)_page$/.test(c)));
  const plainContent = plain && plain.querySelector(".pagedjs_page_content");
  r.defaultPageContentTop = plain && plainContent
    ? Math.round(plainContent.getBoundingClientRect().top - plain.getBoundingClientRect().top)
    : null;

  // ── string() running headers + counter(page) folios. Paged.js renders
  //    margin-box content via a ::after pseudo-element on
  //    .pagedjs_margin-content (string() is pre-resolved into a literal
  //    string per page; counter(page) stays as a live counter). So the
  //    evidence lives in getComputedStyle(el, '::after').content, not in
  //    textContent.
  const marginContents = Array.from(document.querySelectorAll(".pagedjs_margin-content"));
  const stringHeaders = [];
  let counterBoxes = 0;
  let firstContentful = null;
  for (const el of marginContents) {
    const after = getComputedStyle(el, "::after").content;
    if (!after || after === "none" || after === "normal") {
      // Running ELEMENTS (content: element(name)) are real DOM nodes moved
      // into the margin-content box, not pseudo content.
      if ((el.textContent || "").trim()) {
        stringHeaders.push(el.textContent.trim());
        firstContentful = firstContentful || el;
      }
      continue;
    }
    firstContentful = firstContentful || el;
    if (after.includes("counter(")) counterBoxes += 1;
    else if (after.startsWith('"')) stringHeaders.push(after.replace(/^"|"$/g, ""));
  }
  r.marginBoxesWithStringText = stringHeaders.filter((s) => s.length > 0).length;
  r.marginBoxSamples = Array.from(new Set(stringHeaders.filter((s) => s.length > 0))).slice(0, 8);
  r.marginBoxesWithPageCounter = counterBoxes;

  // ── Custom properties inside @page margin boxes: the stylesheets set
  //    font-family/color in margin boxes via var(--…). Report the computed
  //    style of the first contentful margin box — an engine that drops var()
  //    inside margin-box rules shows the UA default instead of the token
  //    value. Compare across engines.
  if (firstContentful) {
    const host = firstContentful.closest(".pagedjs_margin") || firstContentful;
    const cs = getComputedStyle(host);
    r.marginBoxComputed = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, color: cs.color };
  } else {
    r.marginBoxComputed = null;
  }

  // ── position: running() → content: element(name): the probe fixture's
  //    sentinel paragraph should be REMOVED from the page flow and inserted
  //    into the @bottom-left margin boxes as a real DOM node.
  const sentinel = "RUNNING-ELEMENT-SENTINEL";
  const inMargin = marginContents.some((el) => (el.textContent || "").includes(sentinel));
  const inFlow = Array.from(document.querySelectorAll(".pagedjs_page_content .rh-probe"))
    .some((el) => el.offsetParent !== null);
  r.runningElement = document.body.textContent.includes(sentinel)
    ? { movedToMarginBox: inMargin, stillVisibleInFlow: inFlow }
    : null;

  // ── Multi-column sections: computed column-count plus a layout measurement —
  //    do the section's children actually occupy two horizontal bands?
  const colSel = [".section.probe-columns", ".two-column", ".three-column", ".col-split"];
  r.columns = [];
  for (const sel of colSel) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().width > 0);
    const lefts = Array.from(new Set(kids.map((k) => Math.round(k.getBoundingClientRect().left))));
    r.columns.push({
      selector: sel,
      computedColumnCount: cs.columnCount,
      computedColumnGap: cs.columnGap,
      distinctChildLeftEdges: lefts.length,
      sectionWidth: Math.round(el.getBoundingClientRect().width),
    });
  }

  // ── Page geometry sanity: distinct page sizes (collapse symptom: 0×0 pages).
  const sizes = new Set(pages.map((p) => {
    const b = p.getBoundingClientRect();
    return `${Math.round(b.width)}x${Math.round(b.height)}`;
  }));
  r.pageSizes = Array.from(sizes);

  return r;
}

async function probeEngine(name) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`Unknown engine: ${name}`);
  const result = { engine: name, url, ok: false, consoleErrors: [], pageErrors: [] };
  let browser;
  const t0 = Date.now();
  try {
    browser = await engine.launch({ headless: true });
    result.browserVersion = browser.version();
    const page = await browser.newPage();

    // Capture the renderingComplete CustomEvent in EVERY frame (the shell at
    // "/" hosts book.html in an iframe; init scripts run in all frames).
    await page.addInitScript(() => {
      window.__pmdRender = { done: false };
      window.addEventListener("renderingComplete", (e) => {
        window.__pmdRender = { done: true, totalPages: e.detail && e.detail.totalPages };
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") result.consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on("pageerror", (err) => result.pageErrors.push(String(err).slice(0, 500)));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Find the frame that contains the paginated document. "/" serves the
    // preview shell, whose iframe loads /book.html; /book.html loaded
    // directly is the main frame.
    let target = null;
    const deadline = Date.now() + 30_000;
    while (!target && Date.now() < deadline) {
      target = page.frames().find((f) => f.url().includes("book.html")) || null;
      if (!target && page.frames().length === 1) target = page.mainFrame();
      if (!target) await page.waitForTimeout(250);
    }
    if (!target) throw new Error("Could not locate the preview frame (book.html)");

    await target.waitForFunction(() => window.__pmdRender && window.__pmdRender.done, null, {
      timeout: RENDER_TIMEOUT_MS,
      polling: 250,
    });
    result.renderMs = Date.now() - t0;
    result.eventTotalPages = await target.evaluate(() => window.__pmdRender.totalPages ?? null);
    result.probes = await target.evaluate(collectProbes);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err).slice(0, 1000);
    result.renderMs = Date.now() - t0;
  } finally {
    await browser?.close().catch(() => {});
  }
  return result;
}

const results = [];
for (const name of engineNames) {
  console.error(`── probing ${name} …`);
  const r = await probeEngine(name.trim());
  console.error(`   ${name}: ${r.ok ? `OK, ${r.probes.pageCount} pages in ${r.renderMs}ms` : `FAIL: ${r.error}`}`);
  results.push(r);
}

const json = JSON.stringify({ url, when: new Date().toISOString(), results }, null, 2);
if (outFile) writeFileSync(outFile, json);
console.log(json);
