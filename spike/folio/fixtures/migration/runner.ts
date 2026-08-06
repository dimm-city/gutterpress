/**
 * Migration fixture runner — Section B of the Folio migration spike.
 *
 * Builds each of the 8 fixtures (`fixtures/01-*.html` .. `08-*.html`) on BOTH
 * engines and prints a per-fixture table: pages, geometry, assertion result,
 * wall time.
 *
 *   - Folio:   `build()` from `../src/compiler/build.ts` — the same function
 *              `spike/folio/src/cli.ts build` calls (see `cli.ts` line ~74).
 *   - Paged.js: `renderHtmlToPdf()` from the SHIPPED
 *              `packages/cli/src/lib/pagination.ts` — the exact function the
 *              real `gutterpress build` pipeline uses to drive Paged.js and
 *              print. Reused directly, not reimplemented.
 *
 * Every assertion reads the PDF back with an INDEPENDENT reader
 * (`spikes/probe.ts`, which wraps poppler `pdftotext -bbox-layout` /
 * `pdfinfo` / `pdffonts`, or PyMuPDF where available — never Folio's own
 * model, ARCHITECTURE.md §7) plus `edge-ink.py` (this directory) for
 * pixel-level page-edge checks poppler's text/box probes can't answer.
 *
 * Usage:
 *   bun run runner.ts               # the 8 small fixtures only
 *   bun run runner.ts --kitchen-sink   # + the combined book (slow; CI skips)
 *   bun run runner.ts 03            # just fixture 03
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChromium, type Browser } from "../../src/shared/cdp.ts";
import { build } from "../../src/compiler/build.ts";
import { pdfText, pdfInfo, probeBackend } from "../../spikes/probe.ts";

const HERE = import.meta.dir;

// renderHtmlToPdf is the shipped packages/cli pagination entry point — the
// exact function `gutterpress build` calls to drive Paged.js. Reused, not
// duplicated (per the task's instruction to reuse compare/run.ts's approach).
//
// Imported dynamically with a NON-literal specifier (not `import ... from`)
// so tsc never resolves packages/cli's module graph as part of THIS
// program: embedded-assets.ts there uses `with { type: "file" }` asset
// imports (.ico/.icc/.md/.js) that only bun's build understands via
// packages/cli's own markdown-shims.d.ts ambient declarations, which are
// not part of spike/folio/tsconfig.json's `include` and so don't apply here
// — a static import pulled that file into spike/folio's typecheck and
// failed it with TS2307/TS7016. This package is read-only from spike/folio
// per this task's boundaries, so the fix lives on this side.
const paginationModulePath = resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "src",
  "lib",
  "pagination.ts",
);
interface PaginationModule {
  renderHtmlToPdf(htmlFile: string, outPdf: string): Promise<void>;
}
const { renderHtmlToPdf } = (await import(paginationModulePath)) as unknown as PaginationModule;
const FIXTURES_DIR = join(HERE, "fixtures");
const OUT_DIR = join(HERE, "out");
mkdirSync(OUT_DIR, { recursive: true });

process.env.PUPPETEER_EXECUTABLE_PATH ??= existsSync("/usr/bin/google-chrome-stable")
  ? "/usr/bin/google-chrome-stable"
  : "/opt/pw-browsers/chromium";
process.env.FOLIO_CHROMIUM ??= process.env.PUPPETEER_EXECUTABLE_PATH;
process.env.GUTTERPRESS_CHROMIUM_ARGS ??= "--no-sandbox --disable-dev-shm-usage";

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const IN = 72;

function edgeInk(pdfPath: string, page: number, dpi = 72): Record<string, string> {
  const r = spawnSync("python3", [join(HERE, "edge-ink.py"), pdfPath, String(page), String(dpi)], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`edge-ink.py failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

interface EngineResult {
  pages: number;
  ms: number;
  ok: boolean;
  detail: string;
  pdfPath: string;
}

interface FixtureResult {
  id: string;
  folio: EngineResult;
  pagedjs: EngineResult;
  sameSameOrDocumented: string;
}

async function runFolio(browser: Browser, htmlPath: string, pdfOut: string): Promise<EngineResult> {
  const t0 = performance.now();
  try {
    const r = await build({ input: htmlPath, browser });
    const ms = performance.now() - t0;
    writeFileSync(pdfOut, r.bytes);
    return { pages: r.pageCount, ms, ok: true, detail: `tier ${r.tier}, ${r.passes} pass(es)`, pdfPath: pdfOut };
  } catch (err) {
    return { pages: -1, ms: performance.now() - t0, ok: false, detail: String(err), pdfPath: "" };
  }
}

async function runPagedjs(htmlPath: string, pdfOut: string): Promise<EngineResult> {
  const t0 = performance.now();
  try {
    await renderHtmlToPdf(htmlPath, pdfOut);
    const ms = performance.now() - t0;
    const t = pdfText(pdfOut);
    return { pages: t.pageCount, ms, ok: true, detail: "", pdfPath: pdfOut };
  } catch (err) {
    return { pages: -1, ms: performance.now() - t0, ok: false, detail: String(err), pdfPath: "" };
  }
}

// ---------------------------------------------------------------------------
// per-fixture assertions — each reads the PDF back with the independent
// reader (spikes/probe.ts) and returns { pass, detail }.
// ---------------------------------------------------------------------------
type Assertion = (pdfPath: string) => { pass: boolean; detail: string };

const assertions: Record<string, Assertion> = {
  "01-filter-clip-path": (pdfPath) => {
    const t = pdfText(pdfPath);
    const all = t.pages.map((p) => p.text).join("\n");
    const plainOk =
      all.includes("SENTINEL-PLAIN-TEXT-1") &&
      all.includes("SENTINEL-PLAIN-BOX-2") &&
      all.includes("SENTINEL-PLAIN-TEXT-3");
    const filteredGone =
      !all.includes("SENTINEL-FILTERED-CARD-A") && !all.includes("SENTINEL-FILTERED-CARD-B");
    return {
      pass: plainOk && filteredGone,
      detail: `plain text extractable=${plainOk}, filtered text absent (rasterized)=${filteredGone}`,
    };
  },

  "02-fullbleed-running-heads": (pdfPath) => {
    const t = pdfText(pdfPath);
    const pageOf = (needle: string) => t.pages.findIndex((p) => p.text.includes(needle));
    // the continuation page (no h1 of its own) must still carry "Chapter One"
    // as its running head — proves the head repeats on EVERY page, not just
    // chapter-opener pages.
    const continuationIdx = pageOf("SENTINEL-P2E");
    const continuationHeadOk =
      continuationIdx > 0 && // not the opener page itself
      t.pages[continuationIdx].text.includes("Chapter One");
    // the chapter-two page must carry ITS OWN title, not a stale "Chapter One"
    const ch2Idx = pageOf("SENTINEL-P3");
    const ch2HeadOk =
      ch2Idx >= 0 &&
      t.pages[ch2Idx].text.includes("Chapter Two") &&
      !t.pages[ch2Idx].text.replace("Chapter Two — Bellows", "").includes("Chapter One");
    const ink = edgeInk(pdfPath, 1);
    const isTexture = (hex: string) => hex.toLowerCase() !== "#ffffff";
    const bleedOk = ["top", "bottom", "left", "right", "corner"].every((k) => isTexture(ink[k]));
    return {
      pass: continuationHeadOk && ch2HeadOk && bleedOk,
      detail: `continuation page (p${continuationIdx + 1}) carries "Chapter One"=${continuationHeadOk}, chapter-two page head not stale=${ch2HeadOk}; edge ink ${JSON.stringify(ink)}`,
    };
  },

  "03-mirrored-binding": (pdfPath) => {
    const t = pdfText(pdfPath);
    // printed page N (1-based): odd = recto, even = verso. Left inset = x0 of
    // leftmost word; right inset = pageWidth - x1 of rightmost word.
    const info = pdfInfo(pdfPath);
    const pageWidth = info.pages[0]?.mediabox?.[2] ?? 5 * IN;
    const insets = t.pages.map((p) => {
      if (p.words.length === 0) return null;
      const left = Math.min(...p.words.map((w) => w.x0));
      const right = pageWidth - Math.max(...p.words.map((w) => w.x1));
      return { left, right };
    });
    const rectoInsets = insets.filter((_, i) => i % 2 === 0 && insets[i]); // 0-based even -> printed odd -> recto
    const versoInsets = insets.filter((_, i) => i % 2 === 1 && insets[i]);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rectoLeft = avg(rectoInsets.filter(Boolean).map((x) => x!.left));
    const versoLeft = avg(versoInsets.filter(Boolean).map((x) => x!.left));
    const mirrored = Math.abs(rectoLeft - versoLeft) > 10; // >10pt: a real mirror, not noise
    return {
      pass: mirrored,
      detail: `recto left inset avg ${rectoLeft.toFixed(1)}pt, verso left inset avg ${versoLeft.toFixed(1)}pt, |Δ|=${Math.abs(rectoLeft - versoLeft).toFixed(1)}pt`,
    };
  },

  "04-folio-restart": (pdfPath) => {
    const t = pdfText(pdfPath);
    // last non-sentinel token on the page = the @bottom-center folio.
    const folioOf = (needle: string) => {
      const i = t.pages.findIndex((p) => p.text.includes(needle));
      if (i < 0) return { i, folio: "" };
      const lines = t.pages[i].text.trim().split("\n");
      return { i, folio: lines[lines.length - 1].trim() };
    };
    const front1 = folioOf("SENTINEL-FRONT-i");
    const front2 = folioOf("SENTINEL-FRONT-ii");
    const front3 = folioOf("SENTINEL-FRONT-iii");
    const body1 = folioOf("SENTINEL-BODY-1");
    const body2 = folioOf("SENTINEL-BODY-2");
    const body3 = folioOf("SENTINEL-BODY-3");
    const seq = [front1.folio, front2.folio, front3.folio, body1.folio, body2.folio, body3.folio];
    const want = ["i", "ii", "iii", "1", "2", "3"];
    const pass = seq.every((v, i) => v === want[i]);
    return {
      pass,
      detail: `folio sequence: ${JSON.stringify(seq)} (want ${JSON.stringify(want)})`,
    };
  },

  "05-margin-box-furniture": (pdfPath) => {
    const t = pdfText(pdfPath);
    const chipOk = t.pages.every((p, i) => p.text.includes(`CH.${i + 1}`) || p.text.includes(`CH. ${i + 1}`));
    // strip /* ... */ CSS comments first — this file's own comment EXPLAINS
    // that rotate()/box-shadow are unsupported, which would otherwise
    // false-positive the "absent from the CSS" check (ARCHITECTURE.md §8:
    // a check that can't fail is worthless — this one nearly couldn't).
    const src = readFileSync(join(FIXTURES_DIR, "05-margin-box-furniture.html"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const noRotate = !/transform\s*:\s*rotate/.test(src);
    const noBoxShadow = !/box-shadow\s*:/.test(src);
    return {
      pass: chipOk && noRotate && noBoxShadow,
      detail: `chip folio per page=${chipOk}, no rotate()=${noRotate}, no box-shadow=${noBoxShadow}`,
    };
  },

  "06-xref-toc": (pdfPath) => {
    const t = pdfText(pdfPath);
    // find the CONTENT page via a sentinel unique to the chapter body — the
    // heading text itself also appears in the TOC (page 1), so searching for
    // "Chapter One"/"Chapter Three" would match the TOC page, not the target.
    const targetPage = (needle: string) => t.pages.findIndex((p) => p.text.includes(needle)) + 1;
    const ch1Page = targetPage("SENTINEL-XR1");
    const ch3Page = targetPage("SENTINEL-XR3");
    const all = t.pages.map((p) => p.text).join("\n");
    const refs = [...all.matchAll(/\(p\.\s*(\d+)\)/g)].map((m) => Number(m[1]));
    const refsResolved = refs.length >= 2;
    const refsCorrect = refs.includes(ch1Page) && refs.includes(ch3Page);
    return {
      pass: refsResolved && refsCorrect,
      detail: `refs found=${JSON.stringify(refs)}, ch1 on p${ch1Page}, ch3 on p${ch3Page}`,
    };
  },

  "07-multicol-break-avoid": (pdfPath) => {
    const t = pdfText(pdfPath);
    let split = 0;
    let measured = 0;
    // sentinels are hyphen-free single tokens deliberately — poppler's
    // bbox-layout word extraction drops a `-` that lands at a column-wrap
    // point (and puts the pieces on different LINES, not just missing a
    // character), which silently broke this assertion while building the
    // fixture (measured, see README.md).
    for (let n = 1; n <= 12; n++) {
      const id = String(n).padStart(2, "0");
      const top = `SENTINELCARD${id}TOP`;
      const bot = `SENTINELCARD${id}BOT`;
      const topPage = t.pages.findIndex((p) => p.text.includes(top));
      const botPage = t.pages.findIndex((p) => p.text.includes(bot));
      if (topPage < 0 || botPage < 0) continue;
      measured++;
      if (topPage !== botPage) split++;
    }
    return {
      pass: measured > 0 && split === 0,
      detail: `${measured} cards measured, ${split} split across a page boundary`,
    };
  },

  "08-recto-verso-blank": (pdfPath) => {
    const t = pdfText(pdfPath);
    const pageOf = (needle: string) => t.pages.findIndex((p) => p.text.includes(needle)) + 1;
    const c2 = pageOf("SENTINELCHAPTERTWO");
    const c3 = pageOf("SENTINELCHAPTERTHREE");
    const bothRecto = c2 > 0 && c3 > 0 && c2 % 2 === 1 && c3 % 2 === 1;
    return {
      pass: bothRecto,
      detail: `CHAPTERTWO on printed p${c2}, CHAPTERTHREE on printed p${c3} (recto = odd)`,
    };
  },
};

// ---------------------------------------------------------------------------
async function runOne(browser: Browser, id: string): Promise<FixtureResult> {
  const htmlPath = join(FIXTURES_DIR, `${id}.html`);
  const folioPdf = join(OUT_DIR, `${id}.folio.pdf`);
  const pagedPdf = join(OUT_DIR, `${id}.pagedjs.pdf`);

  const folio = await runFolio(browser, htmlPath, folioPdf);
  const pagedjs = await runPagedjs(htmlPath, pagedPdf);

  const assertion = assertions[id];
  if (folio.ok) {
    const r = assertion(folio.pdfPath);
    folio.ok = r.pass;
    folio.detail = r.detail;
  }
  if (pagedjs.ok) {
    const r = assertion(pagedjs.pdfPath);
    pagedjs.ok = r.pass;
    pagedjs.detail = r.detail;
  }

  const sameSameOrDocumented =
    folio.pages === pagedjs.pages
      ? "same page count"
      : `differ ${folio.pages} vs ${pagedjs.pages} — see report`;

  return { id, folio, pagedjs, sameSameOrDocumented };
}

async function main() {
  const args = process.argv.slice(2);
  const kitchenSink = args.includes("--kitchen-sink");
  const only = args.find((a) => !a.startsWith("--"));

  if (kitchenSink && !existsSync(join(FIXTURES_DIR, "99-kitchen-sink.html"))) {
    spawnSync("bun", ["run", join(FIXTURES_DIR, "99-kitchen-sink.ts")], { stdio: "inherit" });
  }

  const ids = [
    "01-filter-clip-path",
    "02-fullbleed-running-heads",
    "03-mirrored-binding",
    "04-folio-restart",
    "05-margin-box-furniture",
    "06-xref-toc",
    "07-multicol-break-avoid",
    "08-recto-verso-blank",
  ].filter((id) => !only || id.startsWith(only));

  console.log(`probe backend: ${probeBackend}`);
  console.log(`chromium: ${process.env.PUPPETEER_EXECUTABLE_PATH}\n`);

  const browser = await launchChromium();
  const results: FixtureResult[] = [];
  try {
    for (const id of ids) {
      console.log(`== ${id}`);
      const r = await runOne(browser, id);
      results.push(r);
      console.log(
        `   folio:    ${r.folio.pages}pp in ${fmt(r.folio.ms)} — ${r.folio.ok ? "PASS" : "FAIL"} (${r.folio.detail})`,
      );
      console.log(
        `   paged.js: ${r.pagedjs.pages}pp in ${fmt(r.pagedjs.ms)} — ${r.pagedjs.ok ? "PASS" : "FAIL"} (${r.pagedjs.detail})`,
      );
      console.log(`   ${r.sameSameOrDocumented}\n`);
    }

    if (kitchenSink) {
      console.log(`== 99-kitchen-sink`);
      const htmlPath = join(FIXTURES_DIR, "99-kitchen-sink.html");
      const folioPdf = join(OUT_DIR, "99-kitchen-sink.folio.pdf");
      const pagedPdf = join(OUT_DIR, "99-kitchen-sink.pagedjs.pdf");
      const folio = await runFolio(browser, htmlPath, folioPdf);
      const pagedjs = await runPagedjs(htmlPath, pagedPdf);
      console.log(`   folio:    ${folio.pages}pp in ${fmt(folio.ms)} (${folio.detail})`);
      console.log(`   paged.js: ${pagedjs.pages}pp in ${fmt(pagedjs.ms)}`);
    }
  } finally {
    await browser.close();
  }

  console.log("\n| fixture | folio pages | folio time | folio assert | paged.js pages | paged.js time | paged.js assert |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    console.log(
      `| ${r.id} | ${r.folio.pages} | ${fmt(r.folio.ms)} | ${r.folio.ok ? "PASS" : "FAIL"} | ${r.pagedjs.pages} | ${fmt(r.pagedjs.ms)} | ${r.pagedjs.ok ? "PASS" : "FAIL"} |`,
    );
  }

  const failed = results.filter((r) => !r.folio.ok || !r.pagedjs.ok);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

if (import.meta.main) await main();
