/**
 * Head-to-head: current Gutterpress (Paged.js) vs the Folio spike, on the
 * SAME document.
 *
 * The input is the pre-pagination `book.html` that Gutterpress itself renders
 * from a real example project (`compare/stage-book.ts` calls the shipped
 * library to produce it), so neither engine gets a hand-tuned document.
 *
 * Three comparisons:
 *   A. compile — each pipeline produces a PDF; page counts, geometry, running
 *      heads, folios, timings and file size are read back out of the PDFs.
 *   B. in-browser pagination — the same book.html paginated in the same
 *      headless Chromium by Paged.js and by the Folio viewer; time + pages.
 *   C. visual — both PDFs rasterised at the same DPI, per-page difference
 *      scored, and side-by-side contact sheets written for eyeballing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureBundles } from "../spikes/bundles.ts";
import { launchChromium } from "../../../packages/cli/src/engine/shared/cdp.ts";
import { build } from "../../../packages/cli/src/engine/compiler/build.ts";
import { inspectPdf } from "../../../packages/cli/src/engine/shared/pdf-inspect.ts";
import { extract, resolvePage } from "../../../packages/cli/src/engine/shared/gcpm-extract.ts";
import { pdfText } from "../spikes/probe.ts";

const REPO = resolve(import.meta.dir, "..", "..", "..");
const WORK = process.env.FOLIO_CMP_DIR ?? "/tmp/cmp";
const PROJECT = process.argv[2] ?? join(REPO, "examples", "gutterpress-user-guide");
const OUT = join(import.meta.dir, "out");
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

const env = {
  ...process.env,
  PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/opt/pw-browsers/chromium",
  GUTTERPRESS_CHROMIUM_ARGS:
    process.env.GUTTERPRESS_CHROMIUM_ARGS ?? "--no-sandbox --disable-dev-shm-usage",
};

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

// ---------------------------------------------------------------------------
// shared input
// ---------------------------------------------------------------------------
console.log(`\n== staging the shared input from ${PROJECT}`);
const stageDir = join(WORK, "staged");
const staged = spawnSync(
  "bun",
  [join(import.meta.dir, "stage-book.ts"), PROJECT, stageDir],
  { cwd: REPO, env, encoding: "utf8" },
);
if (staged.status !== 0) throw new Error(`staging failed: ${staged.stderr}`);
const bookHtml = staged.stdout.trim().split("\n").pop()!;
console.log(`   ${bookHtml} (${kb(statSync(bookHtml).size)})`);

/**
 * Folio may be pointed at a DIFFERENT copy of the staged book — the A/B shim
 * (`compare/apply-shim.ts`) writes `book.shimmed.html` next to `book.html`.
 * Gutterpress always gets the original project, so the Paged.js leg is never
 * affected by the shim. See COMPARISON.md "A/B plan".
 */
const folioInput = process.env.FOLIO_INPUT || bookHtml;
if (folioInput !== bookHtml)
  console.log(`   folio input OVERRIDDEN → ${folioInput} (${kb(statSync(folioInput).size)})`);

// ---------------------------------------------------------------------------
// A. compile
// ---------------------------------------------------------------------------
console.log(`\n== A. compile`);

// a stale PDF from an earlier project would be picked up by findPdf()
const gpOut = join(WORK, "gp");
rmSync(gpOut, { recursive: true, force: true });
const t0 = performance.now();
const gp = spawnSync(
  "bun",
  // --skip-pre-validate: what is being compared is PAGINATION. Folio has no
  // content-validation gate at all, so leaving Gutterpress's on would just
  // abort the run on pre-existing content bugs (e.g. the field guide's four
  // broken image refs) before either engine lays out a single page.
  [
    join(REPO, "packages/cli/src/cli.ts"),
    "build",
    PROJECT,
    "--format",
    "pdf",
    "--out",
    gpOut,
    "--skip-pre-validate",
  ],
  { cwd: REPO, env, encoding: "utf8", timeout: 900_000 },
);
const gpMs = performance.now() - t0;
if (gp.status !== 0) throw new Error(`gutterpress build failed:\n${gp.stdout}\n${gp.stderr}`);
const gpPdf = (readFileSync(join(gpOut, "build-fingerprint.json"), "utf8"), 0),
  gpPdfPath = findPdf(gpOut);
const gpPagedLine = /Paged\.js rendered (\d+) pages \(([\d.]+)px × ([\d.]+)px\)/.exec(gp.stdout);
console.log(`   gutterpress: ${fmt(gpMs)} → ${gpPdfPath} (${kb(statSync(gpPdfPath).size)})`);
void gpPdf;

await ensureBundles();
const browser = await launchChromium();
const t1 = performance.now();
const folio = await build({ input: folioInput, onProgress: (m) => console.log(`     ${m}`) });
const folioColdMs = performance.now() - t1;
const folioPdfPath = join(WORK, "folio.pdf");
writeFileSync(folioPdfPath, folio.bytes);
const t2 = performance.now();
await build({ input: folioInput, browser });
const folioWarmMs = performance.now() - t2;
console.log(
  `   folio:       ${fmt(folioColdMs)} cold / ${fmt(folioWarmMs)} warm → ${folioPdfPath} (${kb(
    folio.bytes.length,
  )}), tier ${folio.tier}`,
);

const gpFacts = await inspectPdf(readFileSync(gpPdfPath));
const folioFacts = await inspectPdf(folio.bytes);
const gpTextRaw = pdfText(gpPdfPath);
const folioTextRaw = pdfText(folioPdfPath);

// ---------------------------------------------------------------------------
// B. in-browser pagination
// ---------------------------------------------------------------------------
console.log(`\n== B. in-browser pagination (same document, same browser)`);
const polyfill = readFileSync(
  join(REPO, "packages/cli/src/assets/vendor/paged.polyfill.js"),
  "utf8",
);
const viewer = readFileSync(join(import.meta.dir, "..", "dist", "folio.js"), "utf8");
const html = readFileSync(folioInput, "utf8");

const page = await browser.newPage();
const loadPolyfillSource = async () => {
  await page.evaluate(`window.__pagedSource = ${JSON.stringify(polyfill)};`);
};

await page.setContent(html);
await page.waitForReady();
await loadPolyfillSource();
const pagedResult = await page.evaluate<any>(`(async () => {
  // Same invocation the build uses: config first, then the polyfill, which
  // auto-runs on ready and calls PagedConfig.after when the flow is done.
  const t0 = performance.now();
  const done = new Promise((resolve) => {
    window.PagedConfig = { after: () => resolve() };
  });
  const s = document.createElement('script');
  s.textContent = window.__pagedSource;
  document.head.appendChild(s);
  await done;
  return { ms: performance.now() - t0,
           pages: document.querySelectorAll('.pagedjs_page').length };
})()`);
console.log(
  `   paged.js: ${pagedResult.pages} pages in ${fmt(pagedResult.ms)} ` +
    `(engine payload ${kb(polyfill.length)})`,
);

await page.setContent(html);
await page.evaluate(`window.__FOLIO_MANUAL__ = true;`);
await page.evaluate(viewer);
await page.waitForReady();
const folioView = await page.evaluate<any>(`(async () => {
  const t0 = performance.now();
  const api = await window.Folio.mount({});
  const ms = performance.now() - t0;
  const t1 = performance.now();
  api.refresh();
  return { ms, update: performance.now() - t1, pages: api.totalPages, warnings: api.warnings };
})()`);
console.log(
  `   folio:    ${folioView.pages} pages in ${fmt(folioView.ms)} ` +
    `(engine payload ${kb(statSync(join(import.meta.dir, "..", "dist", "folio.min.js")).size)} minified), ` +
    `hot update ${fmt(folioView.update)}`,
);

// DOM impact: paged.js rebuilds the document into .pagedjs_page scaffolding;
// folio adds one wrapper per run and an absolutely-positioned layer.
await page.setContent(html);
await page.waitForReady();
const baseNodes = await page.evaluate<number>(`document.querySelectorAll('*').length`);
await page.evaluate(`window.__FOLIO_MANUAL__ = true;`);
await page.evaluate(viewer);
await page.evaluate(`window.Folio.mount({})`);
const folioNodes = await page.evaluate<number>(`document.querySelectorAll('*').length`);
await page.setContent(html);
await page.waitForReady();
await loadPolyfillSource();
const pagedNodes = await page.evaluate<number>(`(async () => {
  const done = new Promise((resolve) => { window.PagedConfig = { after: () => resolve() }; });
  const s = document.createElement('script');
  s.textContent = window.__pagedSource;
  document.head.appendChild(s);
  await done;
  return document.querySelectorAll('*').length;
})()`);
console.log(
  `   DOM nodes: source ${baseNodes} → paged.js ${pagedNodes} (${(
    pagedNodes / baseNodes
  ).toFixed(2)}×), folio ${folioNodes} (${(folioNodes / baseNodes).toFixed(2)}×)`,
);
await page.close();

// ---------------------------------------------------------------------------
// D. fidelity to the author's CSS: break-inside: avoid
// ---------------------------------------------------------------------------
console.log(`\n== D. does each engine honor \`break-inside: avoid\`?`);
const avoidPage = await browser.newPage();
await avoidPage.setContent(html);
await avoidPage.waitForReady();
await avoidPage.evaluate(`window.__pagedSource = ${JSON.stringify(polyfill)};`);
const pagedAvoid = await avoidPage.evaluate<any>(`(async () => {
  const selector = '.section, figure, .callout, .no-break, .example, .spec-block';
  const total = document.querySelectorAll(selector).length;
  const done = new Promise((resolve) => { window.PagedConfig = { after: () => resolve() }; });
  const s = document.createElement('script');
  s.textContent = window.__pagedSource;
  document.head.appendChild(s);
  await done;
  // Paged.js clones content per page and tags every clone with data-ref;
  // a ref that appears on more than one .pagedjs_page was split.
  const byRef = new Map();
  document.querySelectorAll('.pagedjs_page ' + selector).forEach((el) => {
    const ref = el.getAttribute('data-ref');
    const page = el.closest('.pagedjs_page');
    if (!ref || !page) return;
    if (!byRef.has(ref)) byRef.set(ref, new Set());
    byRef.get(ref).add(page);
  });
  let split = 0;
  for (const pages of byRef.values()) if (pages.size > 1) split++;
  return { total, measured: byRef.size, split };
})()`);

await avoidPage.setContent(html);
await avoidPage.evaluate(`window.__FOLIO_MANUAL__ = true;`);
await avoidPage.evaluate(viewer);
await avoidPage.waitForReady();
const folioAvoid = await avoidPage.evaluate<any>(`(async () => {
  const selector = '.section, figure, .callout, .no-break, .example, .spec-block';
  const api = await window.Folio.mount({});
  let split = 0, measured = 0, taller = 0;
  const colH = api.strips[0] ? api.strips[0].el.clientHeight : 0;
  for (const el of document.querySelectorAll(selector)) {
    const [a, b] = api.pageRangeOf(el);
    if (a < 0) continue;
    measured++;
    if (b > a) {
      split++;
      if (el.getBoundingClientRect().height > colH) taller++;
    }
  }
  return { total: document.querySelectorAll(selector).length, measured, split, taller, colH };
})()`);
await avoidPage.close();
console.log(
  `   blocks marked break-inside: avoid — paged.js split ${pagedAvoid.split}/${pagedAvoid.measured}, ` +
    `folio split ${folioAvoid.split}/${folioAvoid.measured} (${folioAvoid.taller} of those are taller than a page, so they must split)`,
);

await browser.close();

// ---------------------------------------------------------------------------
// E. typesetting density — how much of each page does the engine actually use?
// ---------------------------------------------------------------------------
console.log(`\n== E. unused space at the foot of each page`);
const model = extract(
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
);
const geo = resolvePage(model).geometry;
const contentBottom = geo.height - geo.margin.bottom;
const contentTop = geo.margin.top;

function density(t: { pages: any[] }) {
  const gaps: number[] = [];
  for (const pg of t.pages) {
    // body ink only: margin-box content (running head, folio) lives outside
    // the content box and would mask the gap.
    const ws = pg.words.filter((w: any) => w.y1 < contentBottom + 2 && w.y0 > contentTop - 2);
    if (!ws.length) continue;
    gaps.push(contentBottom - Math.max(...ws.map((w: any) => w.y1)));
  }
  gaps.sort((a, b) => a - b);
  return {
    pages: t.pages.length,
    meanGapPt: gaps.reduce((a, c) => a + c, 0) / Math.max(1, gaps.length),
    medianGapPt: gaps[Math.floor(gaps.length / 2)] ?? 0,
    pagesOverAnInch: gaps.filter((g) => g > 72).length,
  };
}
const gpDensity = density(gpTextRaw);
const folioDensity = density(folioTextRaw);
console.log(
  `   gutterpress: median ${gpDensity.medianGapPt.toFixed(0)}pt unused, ` +
    `${gpDensity.pagesOverAnInch}/${gpDensity.pages} pages leave >1in empty`,
);
console.log(
  `   folio:       median ${folioDensity.medianGapPt.toFixed(0)}pt unused, ` +
    `${folioDensity.pagesOverAnInch}/${folioDensity.pages} pages leave >1in empty`,
);

// ---------------------------------------------------------------------------
// C. visual
// ---------------------------------------------------------------------------
console.log(`\n== C. visual`);
const visual = spawnSync(
  "python3",
  [join(import.meta.dir, "visual-diff.py"), gpPdfPath, folioPdfPath, OUT],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);
if (visual.status !== 0) console.log(`   visual diff failed: ${visual.stderr}`);
const visualReport = visual.status === 0 ? JSON.parse(visual.stdout) : null;
if (visualReport) {
  console.log(
    `   ${visualReport.compared} pages compared at ${visualReport.dpi} dpi, ` +
      `mean difference ${(visualReport.meanDiff * 100).toFixed(1)}% of pixels; ` +
      `sheets in compare/out/`,
  );
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const runningHead = (t: any, needle: RegExp) =>
  t.pages.filter((p: any) => needle.test(p.text)).length;

const report = {
  project: PROJECT,
  input: { path: bookHtml, bytes: statSync(bookHtml).size },
  compile: {
    gutterpress: {
      ms: gpMs,
      pages: gpFacts.pageCount,
      pagedjsReported: gpPagedLine ? Number(gpPagedLine[1]) : null,
      bytes: statSync(gpPdfPath).size,
      media: gpFacts.boxes[0]?.media,
      outline: gpFacts.outline.length,
      namedDests: Object.keys(gpFacts.namedDests).length,
      links: Object.keys(gpFacts.linkTargets).length,
    },
    folio: {
      coldMs: folioColdMs,
      warmMs: folioWarmMs,
      tier: folio.tier,
      passes: folio.passes,
      pages: folioFacts.pageCount,
      bytes: folio.bytes.length,
      media: folioFacts.boxes[0]?.media,
      outline: folioFacts.outline.length,
      namedDests: Object.keys(folioFacts.namedDests).length,
      links: Object.keys(folioFacts.linkTargets).length,
    },
  },
  browser: {
    pagedjs: { ...pagedResult, payloadBytes: polyfill.length, domNodes: pagedNodes },
    folio: {
      ...folioView,
      payloadBytes: statSync(join(import.meta.dir, "..", "dist", "folio.min.js")).size,
      domNodes: folioNodes,
    },
    sourceDomNodes: baseNodes,
  },
  text: {
    gutterpressPagesWithFolio: runningHead(gpTextRaw, /^\s*\d+\s*$/m),
    folioPagesWithFolio: runningHead(folioTextRaw, /^\s*\d+\s*$/m),
  },
  visual: visualReport,
  breakInsideAvoid: { pagedjs: pagedAvoid, folio: folioAvoid },
  density: { gutterpress: gpDensity, folio: folioDensity, contentBox: { top: contentTop, bottom: contentBottom } },
};
writeFileSync(join(OUT, "comparison.json"), JSON.stringify(report, null, 2));
console.log(`\nwrote ${join(OUT, "comparison.json")}`);

function findPdf(dir: string): string {
  const { readdirSync } = require("node:fs");
  const pdf = readdirSync(dir).find((f: string) => f.endsWith(".pdf"));
  if (!pdf) throw new Error(`no PDF in ${dir}`);
  return join(dir, pdf);
}

void existsSync;
