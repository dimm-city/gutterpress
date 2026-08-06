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
 *   bun run runner.ts               # the 8 small fixtures + 03b, all 9
 *   bun run runner.ts --kitchen-sink   # + the combined book (slow; CI skips)
 *   bun run runner.ts 03            # just fixture 03 (and 03b, prefix match)
 *   bun run runner.ts --prove-falsifiable   # mutate/confirm-FAIL/restore
 *                                    # every fixture's assertion once, in-repo
 *                                    # (ARCHITECTURE.md §8) — exits 1 if any
 *                                    # mutation fails to flip its assertion
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
// The Paged.js leg leaves browser-pool.ts's shared pre-warmed puppeteer
// browser alive, which keeps the process from ever exiting (measured: the
// table prints in seconds, then the run hangs for minutes until killed).
// Same non-literal-specifier rationale as paginationModulePath above.
const browserPoolModulePath = resolve(
  HERE, "..", "..", "..", "..", "packages", "cli", "src", "lib", "browser-pool.ts",
);
interface BrowserPoolModule {
  closeBrowser(): Promise<void>;
}
const { closeBrowser } = (await import(browserPoolModulePath)) as unknown as BrowserPoolModule;
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
    // printed page N (1-based, keyed to the PDF's own page order — this
    // fixture has no front matter, so PDF index IS printed order, per
    // MIGRATION.md Pitfalls "PDF page parity ≠ printed page parity"): odd =
    // recto (right-hand), even = verso (left-hand). Left inset = x0 of the
    // leftmost word on the page — reliable, because body text always starts
    // flush against the content box's left edge. (The right edge is NOT
    // reliable: short lines don't reach it, so pageWidth - max(x1) measures
    // wherever the last line happened to wrap, not the margin — that's why
    // this assertion, like the one it replaces, only ever reads left insets.)
    const left = t.pages.map((p) => (p.words.length ? Math.min(...p.words.map((w) => w.x0)) : null));
    const rectoLeft = left.filter((_, i) => i % 2 === 0 && left[i] != null) as number[]; // printed odd -> recto
    const versoLeft = left.filter((_, i) => i % 2 === 1 && left[i] != null) as number[]; // printed even -> verso
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rectoAvg = avg(rectoLeft);
    const versoAvg = avg(versoLeft);
    // the fixture declares outer = 0.625in (45pt), inner/binding = 0.875in
    // (63pt), with `@page chapter:right { margin-left: 0.625in }` (recto's
    // left margin is the OUTER edge) and `@page chapter:left { margin-left:
    // 0.875in }` (verso's left margin is the INNER/binding edge) — see the
    // fixture's own comment and MIGRATION.md's literal-length root-cause
    // fixture (`@page :right { margin-left: 0.5in }`, same convention).
    // The OLD assertion (`|rectoLeft - versoLeft| > 10`) only detects that
    // the two parities differ — it passes identically whether the mirror is
    // the right way round or backwards (spine on the wrong side, the
    // unprintable-book defect: swap the :left/:right rule BODIES and
    // rectoLeft/versoLeft still differ by the same 18pt, just on the wrong
    // pages). Assert the actual DIRECTION: recto's left inset must be the
    // declared OUTER value, verso's the declared INNER (binding) value.
    const OUTER = 0.625 * IN; // 45pt
    const INNER = 0.875 * IN; // 63pt
    const TOL = 6; // pt
    const near = (a: number, b: number) => Math.abs(a - b) < TOL;
    const rectoOk = near(rectoAvg, OUTER);
    const versoOk = near(versoAvg, INNER);
    return {
      pass: rectoOk && versoOk,
      detail: `recto left inset avg ${rectoAvg.toFixed(1)}pt (want ${OUTER}pt, outer), verso left inset avg ${versoAvg.toFixed(1)}pt (want ${INNER}pt, inner/binding)`,
    };
  },

  "03b-mirrored-binding-var": (pdfPath) => {
    const t = pdfText(pdfPath);
    const left = t.pages
      .map((p) => (p.words.length ? Math.min(...p.words.map((w) => w.x0)) : null))
      .filter((x): x is number => x != null);
    const avg = left.reduce((a, b) => a + b, 0) / left.length;
    const DECLARED = 1.25 * IN; // 90pt — Y, the correct outcome
    const FALLBACK = 1.0 * IN; // 72pt — X, var()'s own fallback text used instead of :root
    const DROPPED = 0.75 * IN; // 54pt — base @page margin, declaration discarded outright
    const TOL = 6;
    const near = (a: number, b: number) => Math.abs(a - b) < TOL;
    const outcome = near(avg, DECLARED) ? "correct" : near(avg, FALLBACK) ? "fallback" : near(avg, DROPPED) ? "dropped" : "unknown";
    return {
      pass: outcome === "correct",
      detail: `left inset avg ${avg.toFixed(1)}pt -> ${outcome} (correct=${DECLARED}pt, fallback=${FALLBACK}pt, dropped=${DROPPED}pt)`,
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
    // F5: the OLD version of this check read the FIXTURE'S OWN .html source
    // and grepped for the absence of `transform: rotate`/`box-shadow` — a
    // lint on a checked-in file, not an observation of what either engine
    // actually rendered. Both engines produce the identical verdict (the
    // file either contains the strings or it doesn't), so it can never tell
    // Folio and Paged.js apart and can never catch a real rendering defect.
    // A margin box's `transform: rotate()`/`box-shadow` support genuinely
    // has no output-observable signature to assert AGAINST here (there is
    // nothing in the PDF that proves a property was never applied — the
    // absence of a visual effect is not evidence, and this fixture doesn't
    // exercise either property in the first place). So: don't assert a
    // negative from the DOM. Assert what IS observable from the OUTPUT —
    // that the chip actually rendered as margin-box furniture: bottom-right
    // positioned, not inline body content. Poppler's bbox-layout gives each
    // "CH.N" token's own bounding box; check it lands OUTSIDE the content
    // box (below the bottom margin edge) and in the right half of the page
    // — i.e. actually in the @bottom-right margin box, not floated into the
    // body text by accident.
    const info = pdfInfo(pdfPath);
    const pageWidth = info.pages[0]?.mediabox?.[2] ?? 5 * IN;
    const pageHeight = info.pages[0]?.mediabox?.[3] ?? 7.5 * IN;
    const contentBottom = pageHeight - 0.75 * IN; // the fixture's base @page margin
    const positionOk = t.pages.every((p) => {
      const w = p.words.find((w) => /^CH\.?\s*\d+$/.test(w.text));
      return !!w && w.y0 > contentBottom && (w.x0 + w.x1) / 2 > pageWidth / 2;
    });
    return {
      pass: chipOk && positionOk,
      detail: `chip folio per page=${chipOk}, chip positioned in bottom-right margin box (below y=${contentBottom.toFixed(1)}pt, right of x=${(pageWidth / 2).toFixed(1)}pt) on every page=${positionOk}`,
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
// P1b: --prove-falsifiable — a defined, reproducible mutation per fixture
// (ARCHITECTURE.md §8: a test must be able to fail). Every fixture's
// assertion is falsified with a single, targeted textual mutation, run
// through BOTH engines, confirmed to FAIL, then the fixture is restored
// byte-identical. This used to exist only as a throwaway, uncommitted
// harness for fixtures 01/02/05/06 (3/4/7/8 had their transcripts
// hand-copied into README.md already) — this makes the whole proof
// re-runnable in-repo for all 8, not just documented as having happened once.
interface Mutation {
  file: string;
  from: string | RegExp;
  to: string;
  note: string;
}
const MUTATIONS: Record<string, Mutation> = {
  "01-filter-clip-path": {
    file: "01-filter-clip-path.html",
    from: `    clip-path: polygon(4% 0, 96% 0, 100% 30%, 100% 100%, 0 100%, 0 30%);\n    filter: drop-shadow(3pt 3pt 0 #7a6a4a);\n`,
    to: "",
    note: "remove the filter + clip-path pair from .card",
  },
  "02-fullbleed-running-heads": {
    file: "02-fullbleed-running-heads.html",
    from: `string-set: chapter-title content(); `,
    to: "",
    note: "remove string-set from the chapter h1",
  },
  "03-mirrored-binding": {
    file: "03-mirrored-binding.html",
    from: `  @page chapter:left  { margin-left: 0.875in; margin-right: 0.625in; }\n  @page chapter:right { margin-left: 0.625in; margin-right: 0.875in; }\n`,
    to: "",
    note: "delete the @page chapter:left/:right mirror rules",
  },
  "03b-mirrored-binding-var": {
    file: "03b-mirrored-binding-var.html",
    from: `    margin-left: var(--binding-margin, 1in); /* binding side: X fallback = 1in = 72pt, Y = 1.25in = 90pt */\n`,
    to: `    margin-left: 0.625in;\n`,
    note: "replace the var()-declared binding margin with the outer literal (no binding offset at all)",
  },
  "04-folio-restart": {
    file: "04-folio-restart.html",
    from: `.page-chapter-start { page: body-main; counter-reset: page 1; }`,
    to: `.page-chapter-start { page: body-main; }`,
    note: "remove counter-reset: page 1 (keep the page-name change)",
  },
  "05-margin-box-furniture": {
    file: "05-margin-box-furniture.html",
    from: `content: "CH." counter(page);`,
    to: `content: "CH.1";`,
    note: "replace the chip's counter(page) with a fixed literal",
  },
  "06-xref-toc": {
    file: "06-xref-toc.html",
    from: /href="#ch1"/g,
    to: `href="#zz-nonexistent"`,
    note: "point the ch1 hrefs at a nonexistent id",
  },
  "07-multicol-break-avoid": {
    file: "07-multicol-break-avoid.html",
    from: `  .card {\n    break-inside: avoid;\n`,
    to: `  .card {\n`,
    note: "remove break-inside: avoid from .card",
  },
  "08-recto-verso-blank": {
    file: "08-recto-verso-blank.html",
    from: `h1 { break-before: right; font-size: 14pt; margin: 0 0 8pt; }`,
    to: `h1 { break-before: page; font-size: 14pt; margin: 0 0 8pt; }`,
    note: "change break-before: right to break-before: page",
  },
};

interface ProveResult {
  id: string;
  note: string;
  folio: { ok: boolean; detail: string };
  pagedjs: { ok: boolean; detail: string };
  restoredByteIdentical: boolean;
}

async function proveOne(browser: Browser, id: string): Promise<ProveResult> {
  const m = MUTATIONS[id];
  if (!m) throw new Error(`no mutation defined for ${id}`);
  const path = join(FIXTURES_DIR, m.file);
  const original = readFileSync(path, "utf8");
  const matched = typeof m.from === "string" ? original.includes(m.from) : m.from.test(original);
  if (!matched) throw new Error(`mutation anchor not found in ${m.file} — fixture text drifted, update MUTATIONS`);
  const mutated =
    typeof m.from === "string" ? original.split(m.from).join(m.to) : original.replace(m.from, m.to);
  if (mutated === original) throw new Error(`mutation was a no-op for ${id}`);

  writeFileSync(path, mutated);
  try {
    const folioPdf = join(OUT_DIR, `${id}.mutated.folio.pdf`);
    const pagedPdf = join(OUT_DIR, `${id}.mutated.pagedjs.pdf`);
    const folio = await runFolio(browser, path, folioPdf);
    const pagedjs = await runPagedjs(path, pagedPdf);
    const assertion = assertions[id];
    const folioR = folio.ok ? assertion(folio.pdfPath) : { pass: false, detail: folio.detail };
    const pagedjsR = pagedjs.ok ? assertion(pagedjs.pdfPath) : { pass: false, detail: pagedjs.detail };
    return {
      id,
      note: m.note,
      folio: { ok: folioR.pass, detail: folioR.detail },
      pagedjs: { ok: pagedjsR.pass, detail: pagedjsR.detail },
      restoredByteIdentical: false, // set below, after restore
    };
  } finally {
    writeFileSync(path, original);
  }
}

async function runFalsifiabilityProof(browser: Browser, ids: string[]): Promise<boolean> {
  console.log(`\n== --prove-falsifiable: mutate -> confirm FAIL on both engines -> restore ==\n`);
  let allExpected = true;
  for (const id of ids) {
    if (!MUTATIONS[id]) continue;
    const path = join(FIXTURES_DIR, MUTATIONS[id].file);
    const before = readFileSync(path, "utf8");
    const r = await proveOne(browser, id);
    const after = readFileSync(path, "utf8");
    r.restoredByteIdentical = before === after;
    if (!r.restoredByteIdentical) throw new Error(`FAILED TO RESTORE ${MUTATIONS[id].file} byte-identical`);

    const expectedFail = !r.folio.ok && !r.pagedjs.ok;
    if (!expectedFail) allExpected = false;
    console.log(`-- ${id} — ${r.note}`);
    console.log(`   folio:    ${r.folio.ok ? "PASS (unexpected — assertion could not fail!)" : "FAIL (expected)"} — ${r.folio.detail}`);
    console.log(`   paged.js: ${r.pagedjs.ok ? "PASS (unexpected — assertion could not fail!)" : "FAIL (expected)"} — ${r.pagedjs.detail}`);
    console.log(`   restored byte-identical: ${r.restoredByteIdentical}\n`);
  }
  console.log(allExpected ? "All mutations correctly flipped their assertion to FAIL." : "SOME MUTATIONS DID NOT FAIL — see above, the assertion in question can no longer fail and must be fixed.");
  return allExpected;
}

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
  const proveFalsifiable = args.includes("--prove-falsifiable");
  const only = args.find((a) => !a.startsWith("--"));

  if (kitchenSink && !existsSync(join(FIXTURES_DIR, "99-kitchen-sink.html"))) {
    spawnSync("bun", ["run", join(FIXTURES_DIR, "99-kitchen-sink.ts")], { stdio: "inherit" });
  }

  const ids = [
    "01-filter-clip-path",
    "02-fullbleed-running-heads",
    "03-mirrored-binding",
    "03b-mirrored-binding-var",
    "04-folio-restart",
    "05-margin-box-furniture",
    "06-xref-toc",
    "07-multicol-break-avoid",
    "08-recto-verso-blank",
  ].filter((id) => !only || id.startsWith(only));

  console.log(`probe backend: ${probeBackend}`);
  console.log(`chromium: ${process.env.PUPPETEER_EXECUTABLE_PATH}\n`);

  const browser = await launchChromium();

  if (proveFalsifiable) {
    try {
      const allExpected = await runFalsifiabilityProof(browser, ids);
      process.exitCode = allExpected ? 0 : 1;
    } finally {
      await browser.close();
      await closeBrowser();
    }
    return;
  }

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

  // KNOWN_DIVERGENCES: fixtures whose Paged.js assertion is EXPECTED to fail
  // today, with a documented, measured reason (README.md's "Divergences"
  // section) — a Paged.js defect, not a Folio regression. Keeping the exit
  // code green through these entries lets this runner be a real CI gate
  // (fails on an UNEXPECTED break) instead of permanently red on findings
  // this spike already recorded on purpose.
  const KNOWN_DIVERGENCES: Record<string, "folio" | "pagedjs"> = {
    // 03b (var()-declared binding margin) was here until packages/cli's
    // page-var-resolve.ts started substituting :root tokens into @page
    // blocks before the CSS reaches Paged.js — both engines now PASS it.
    "04-folio-restart": "pagedjs",
    "08-recto-verso-blank": "pagedjs",
  };
  const unexpectedFailures = results.filter((r) => {
    const knownEngine = KNOWN_DIVERGENCES[r.id];
    const folioBad = !r.folio.ok && knownEngine !== "folio";
    const pagedjsBad = !r.pagedjs.ok && knownEngine !== "pagedjs";
    return folioBad || pagedjsBad;
  });
  const surprises = results.filter((r) => {
    const knownEngine = KNOWN_DIVERGENCES[r.id];
    return knownEngine && (knownEngine === "folio" ? r.folio.ok : r.pagedjs.ok);
  });
  if (surprises.length > 0) {
    console.log(
      `\nNote: ${surprises.map((r) => r.id).join(", ")} PASSED on the engine documented as a known failure — README.md's "Divergences" section is stale, update it.`,
    );
  }
  process.exitCode = unexpectedFailures.length > 0 ? 1 : 0;
  // Tear down the Paged.js leg's shared pre-warmed browser, or the process
  // never exits (see the closeBrowser import note above).
  await closeBrowser();
}

if (import.meta.main) await main();
