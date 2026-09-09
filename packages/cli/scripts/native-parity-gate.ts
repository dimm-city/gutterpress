#!/usr/bin/env bun
/**
 * Phase 5 parity gate — native-only migration plan.
 *
 * The desktop preview and the shipped PDF use DIFFERENT fragmenters: the
 * in-browser viewer (`src/engine/viewer/fragment.ts`, what an author sees
 * live) vs Chromium's own print engine (what `printToPDF` actually lays
 * out). Both are exercised for real by `build()` itself — the Tier 3
 * "predict-then-verify" step (`build.ts`'s `predictPageMap`) already mounts
 * the viewer against the SAME document and compares its opinion of every
 * instrumented id's page against what printing measured, purely as a
 * fixpoint speed optimization. This script does not reimplement that
 * measurement — it reads it back out through the `predicted`/`pageMap`/
 * `resetSites`/`viewport` fields `build.ts` exposes on `BuildResult`
 * specifically for this gate, and asserts on it.
 *
 * For each fixture book (built once, ordinary `build()` call, no extra
 * prints beyond what a real `gutterpress build` already pays for):
 *
 *   (a) total page count — viewer vs print.
 *   (b) page-of-element mapping for every instrumented id — the viewer's
 *       `pageOf()` (carried in `predicted.pageMap`) vs the compiler's
 *       measured page map (`pageMap`, read from the printed PDF's named
 *       destinations). Only meaningful for a Tier 3 book (one that actually
 *       has `target-counter()`/`string-set`/recto-verso breaks/counter
 *       resets to instrument) — a Tier 1/2 book instruments nothing on its
 *       own, so (d) below is what covers it.
 *   (c) resolved `target-counter()` values — both page maps run through the
 *       SAME conversion the compiler itself uses to turn a physical page
 *       into the folio a `target-counter()` reference actually prints
 *       (`restartedPageValues` + `toFolioPage`, `shared/synthesis.ts`), so a
 *       counter-reset restart is honored on both sides identically.
 *   (d) per-heading page-of-element mapping, for EVERY fixture regardless of
 *       tier: `stage()` instruments every heading with a stable id (reusing
 *       one if the author already gave it) and an EMPTY self-referential
 *       `<a href="#id">` right inside it (see `instrumentHeadingIds()`).
 *       Chromium's `printToPDF` only emits a PDF named destination for an id
 *       that some in-document link actually resolves to (measured — a bare
 *       `id` with no link gets no /Dest); the empty anchor contributes zero
 *       width/height so it cannot perturb pagination, and is genuinely the
 *       same mechanism (b) already relies on for Tier 3's own target ids —
 *       just applied to headings so a Tier 1/2 book gets real per-id
 *       coverage too, not only the whole-document page count. Print side
 *       reads `inspectPdf(result.bytes)`'s `namedDests`; the viewer side is
 *       `viewerPageMap()`'s own mount, since a Tier 1/2 book never ran
 *       `predictPageMap` and Tier 3's `predicted.pageMap` is scoped to its
 *       own target ids, not these headings.
 *
 *   (e) exact-fit boundary measurement, only when (d) found a two-sided
 *       disagreement. Print positions each line on whole CSS pixels while
 *       multicol keeps 1/64px, so the same line sits up to ~0.4px lower or
 *       higher in the preview than in the PDF. When that line's box ends
 *       within that drift of the column bottom, one fragmenter keeps it and
 *       the other overflows it — and with `orphans`/`widows` and
 *       `break-*: avoid` in play each then chooses a different, CORRECT
 *       break, so every heading downstream reports a divergence (91 of them
 *       on issue #261, all from one 0.6px input difference; again on #268).
 *       That is not a fragmenter bug, so the gate measures it instead of
 *       listing its consequences: it takes the FIRST disagreeing heading in
 *       document order, walks forward from the last agreeing heading's page
 *       to the first page whose LAST line the two fragmenters disagree on,
 *       and measures the disputed line's box bottom against the column
 *       height on both sides. Print side: the line's baseline from the PDF's
 *       text runs (`getTextPass`) plus the line box's baseline-to-bottom
 *       tail. Viewer side: per-character `Range` rects grouped into lines,
 *       line-box extents and baselines from font metrics measured on a
 *       probe OUTSIDE the document flow (nothing in the book moves), and —
 *       when print kept the line — the viewer's pushed chain has its
 *       `avoid`/`orphans`/`widows` rules neutralised and is relaid out so
 *       the projection reads the viewer's GEOMETRY, not its break choice.
 *       See `measureExactFitBoundary` / `EXACT_FIT_BROWSER_JS`.
 *
 * A Tier 1/2 book (no `predicted` map — nothing was instrumented for target-
 * counter() purposes) still gets (a): a second, independent viewer mount
 * (this script's own `viewerPageMap`), pinned to the exact same `viewport`
 * the build itself measured against, so a page-count mismatch is a real
 * fragmentation divergence, not an artifact of an unpinned viewport.
 *
 * Every fixture ends in exactly one of three outcomes:
 *
 *   CLEAN — no divergence.
 *   EXACT-FIT BOUNDARY — (d) disagreed, (e) measured the first boundary in
 *     both fragmenters, and the two slacks have OPPOSITE fit outcomes (the
 *     keeping side's line box ends at or above the column bottom — within
 *     `EXACT_FIT_TOLERANCE_PX` of it, allowing for rounding — the pushing
 *     side's projected box ends below it) and differ by at most
 *     `EXACT_FIT_TOLERANCE_PX` (1px). The measurements are printed (page,
 *     line text, print slack, viewer slack, delta), the DOWNSTREAM
 *     divergences — two-sided ones both fragmenters place on the boundary
 *     page or later (`isDownstream`) — are listed for information but not
 *     counted, and the fixture PASSES with this distinct outcome. This is a
 *     measured classification of one boundary, never an excuse list: a
 *     one-sided MISSING or a divergence upstream of the boundary still
 *     counts, and the run still fails if the boundary cannot be measured,
 *     if the pushing side fits the line once its break rules are
 *     neutralised (a break-rule disagreement), or if the slacks differ by
 *     more than the tolerance.
 *   DIVERGENCE — anything else. Any divergence must be an explicit entry in
 *     KNOWN_DIVERGENCES with a reason — never a silent tolerance. An
 *     unlisted divergence fails the run (exit 1).
 *
 * Usage:
 *   bun scripts/native-parity-gate.ts
 *   bun scripts/native-parity-gate.ts <project-dir> [<project-dir> ...]
 */
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocumentProxy } from "unpdf";
import type { PDFDocumentProxy } from "unpdf/pdfjs";
import { launchChromium, type Browser, type Session } from "../src/engine/shared/cdp.ts";
import { build, type BuildResult } from "../src/engine/compiler/build.ts";
import { restartedPageValues, toFolioPage } from "../src/engine/shared/synthesis.ts";
import { inspectPdf } from "../src/engine/shared/pdf-inspect.ts";
import { getPageSize, getTextPass, type TextRun } from "../src/lib/pdf-inspect.ts";
import { loadManifestWithPath, resolveConfig } from "../src/lib/manifest.ts";
import { renderChaptersToFile } from "../src/lib/markdown/index.ts";
import { loadPluginsWithCss } from "../src/lib/markdown/plugins.ts";
import { type AssetCopy } from "../src/lib/asset-inline.ts";
import { stageBookAssets } from "../src/lib/build-staging.ts";
import { getAssetPath } from "../src/lib/embedded-assets.ts";

const REPO = resolve(import.meta.dir, "..", "..", "..");
const WORK = process.env.GUTTERPRESS_PARITY_DIR ?? "/tmp/gutterpress-parity";
const PX_PER_PT = 96 / 72;
/** How far apart the two fragmenters' slacks may be at an exact-fit boundary (CSS px). */
export const EXACT_FIT_TOLERANCE_PX = 1;

const DEFAULT_FIXTURES = [
  // examples/with-design-guide is 3 separate manifests, not one book — run
  // all 3 so the gate covers the whole example, not an arbitrary pick.
  join(REPO, "examples", "with-design-guide", "book-01"),
  join(REPO, "examples", "with-design-guide", "book-02"),
  join(REPO, "examples", "with-design-guide", "design-guide"),
  // The three-repro spike fixture (committed): it pinned the running-heads
  // regression where `<gp-anchor>`'s zero-size `position:absolute` first
  // child, sitting immediately after a forced `break-before: page`, measured
  // one page late in print (headingPageMap divergence on pages 2-3) — see
  // agent.ts's `ensureAnchor`.
  join(REPO, "docs", "fixtures", "css-authoring-spike", "book"),
  // The gp-* image-positioning fixture (committed): floats/sizes/spacing in
  // flow plus @page-scoped .gp-pin images. The gate holds the vocabulary to
  // identical page maps in both renderers; the pins are out-of-flow, so any
  // divergence here means the image CSS itself perturbed fragmentation.
  // (In-page pin GEOMETRY is asserted by paged-css-image-pin.test.ts — the
  // gate only sees page indices.)
  join(REPO, "docs", "fixtures", "gp-image-positioning", "book"),
  // The .gp-grid-* fixture (committed): slotted grid pages whose rows
  // fragment across sheets — the measured behavior the vocabulary shipped
  // on (Chromium 151 evidence pack) — with headings buried deep in each
  // grid track so check (d) pins which sheet every one lands on in both
  // renderers. (Print-side geometry across the cut is asserted by
  // build.grid-fragmentation.test.ts — the gate holds the viewer to the
  // same page maps.)
  join(REPO, "docs", "fixtures", "gp-grid", "book"),
  // The mirrored-margins fixture (committed): `@page :left` / `@page :right`
  // swapping the binding and outer margin — what every bound book does.
  // Chromium honours the pseudo-page margins when it prints; the viewer sized
  // its columns from the pseudo-LESS `@page` rule, so its lines held more text
  // than print's and its page count drifted below the PDF's a little more with
  // every page (dc-op-manual field guide: 280 preview pages vs 288 printed —
  // see `runPageBox` in viewer/fragment.ts). Five pages reproduce it.
  join(REPO, "docs", "fixtures", "mirrored-margins", "book"),
  // The atomic-blocks fixture (committed): `break-inside: avoid` on a card
  // that is a direct child of the flow root. Print moves such a card whole and
  // leaves a short page; the viewer's own chrome carried a
  // `.gp-strip > * { break-inside: auto }` that outranked the author at equal
  // specificity and split it (6pp print vs 5pp viewer — see the NOTE in
  // viewer/viewer.css).
  join(REPO, "docs", "fixtures", "atomic-blocks", "book"),
  // The recto-chapters fixture (committed): `h1 { break-before: recto }`, the
  // ordinary chapter-opener idiom. Chromium treats `recto` as a plain page
  // break, so both renderers insert the blank verso themselves. The viewer's
  // spacer carried `break-after: column`, which lands at the same break point
  // as the chapter's own `break-before: recto` — the values combine, the
  // author's `recto` wins, and multicol discards it. One break instead of
  // two, so no blank page appeared: 14 preview pages against 16 printed, every
  // chapter after the first landing on the wrong side (issue #161).
  join(REPO, "docs", "fixtures", "recto-chapters", "book"),
  // The two shipped example books (issue #160). They are the only fixtures
  // here that are real, author-written books rather than minimal repros, and
  // they are what caught BOTH overflow-monolithic divergences: `pre code {
  // overflow-x: auto }` in with-validation and `pre { overflow: hidden }` in
  // the user guide. Registered so an everyday book cannot drift again.
  join(REPO, "examples", "with-validation"),
  join(REPO, "examples", "gutterpress-user-guide"),
  // The exact-fit boundary fixture (committed): the #268 boundary as a slice
  // of the user guide's styling chapter on the rules of its stylesheet that
  // bear on it, so check (e)'s EXACT-FIT outcome stays exercised — see
  // docs/native-parity-gate.md for the numbers. On another font stack or
  // Chromium the same book may read CLEAN instead: also a pass, never a
  // failure.
  join(REPO, "docs", "fixtures", "exact-fit-boundary", "book"),
];

type DivergenceKind = "pageCount" | "pageMap" | "targetCounter" | "headingPageMap";

export interface Divergence {
  fixture: string;
  kind: DivergenceKind;
  detail: string;
  /** where each side put the element, when both sides measured it */
  printPage?: number;
  viewerPage?: number;
}

type FixtureOutcome = "clean" | "exact-fit" | "divergence";

/** Check (e)'s measurement of the first disputed page boundary, in CSS px from the column top. */
interface ExactFitBoundary {
  /** the page both fragmenters filled up to the disputed line */
  page: number;
  keptBy: "print" | "viewer";
  /** the first heading whose page differs, and where each side put it */
  headingId: string;
  headingPrintPage: number;
  headingViewerPage: number;
  text: string;
  block: string;
  lineIndex: number;
  lineCount: number;
  contentHPx: number;
  printBaselinePx: number;
  printBottomPx: number;
  printSlackPx: number;
  viewerBaselinePx: number;
  viewerBottomPx: number;
  viewerSlackPx: number;
  /** keeping side's slack minus pushing side's slack */
  deltaPx: number;
}

/**
 * Explicit allowlist: every entry names exactly what it excuses and why. A
 * divergence NOT matched here fails the run. Empty until a real, understood
 * divergence is found — see this script's own report output for what was
 * actually observed on this run.
 */
const KNOWN_DIVERGENCES: Array<{
  fixture: string;
  kind: DivergenceKind;
  reason: string;
}> = [];

function isKnown(d: Divergence) {
  return KNOWN_DIVERGENCES.find((k) => k.fixture === d.fixture && k.kind === d.kind);
}

/**
 * Give every heading a stable id (reusing the author's own if present) plus
 * an EMPTY self-referential `<a href="#id">` right inside its opening tag —
 * the mechanism `inspectPdf`'s `namedDests` and the compiler's own Tier 3
 * measurement channel both rely on: Chromium's `printToPDF` only emits a PDF
 * named destination for an id some in-document link actually resolves to, a
 * bare unlinked `id` gets no /Dest (measured). The anchor is empty (no text
 * content), so it contributes zero width/height and cannot perturb line
 * breaking or pagination — this is what lets check (d) run on every fixture
 * regardless of tier, not just the Tier 3 books that already instrument
 * their own target-counter() ids.
 */
function instrumentHeadingIds(html: string): { html: string; ids: string[] } {
  let n = 0;
  const ids: string[] = [];
  const instrumented = html.replace(
    /<h([1-6])((?:\s+[^>]*)?)>/g,
    (_match, level: string, attrs: string) => {
      const existing = attrs.match(/\sid="([^"]*)"/);
      const id = existing ? existing[1] : `gp-parity-h${n++}`;
      ids.push(id);
      const idAttr = existing ? "" : ` id="${id}"`;
      return `<h${level}${attrs}${idAttr}><a href="#${id}" class="gp-parity-anchor"></a>`;
    },
  );
  return { html: instrumented, ids };
}

// ---------------------------------------------------------------------------
// stage a project dir into a self-contained book.html — the exact call
// build-runner.ts's renderBook() makes (resolveConfig -> loadPluginsWithCss
// -> renderChaptersToFile -> stageBookAssets), so every fixture is staged as
// a real book would be. Also instruments every heading
// (`instrumentHeadingIds`) so check (d) has stable ids to compare, in every
// fixture regardless of tier.
//
// The asset step is the SHARED `stageBookAssets`, not a private copy: a
// hand-rolled `copyFile` loop here died with a raw ENOENT on the first stale
// image path, which meant the one tool that enforces preview↔print parity
// could not be pointed at a real book (the dc-op-manual field guide was in
// exactly that state), and it silently skipped the build's `.gp-shape`
// inlining, so the gate measured a document no build ever produces. Missing
// files now get the same magenta placeholder the build ships — same document,
// same layout — and are reported below rather than ignored.
// ---------------------------------------------------------------------------
async function stage(
  projectDir: string,
  outDir: string,
): Promise<{ htmlPath: string; headingIds: string[] }> {
  const { manifest, manifestPath } = await loadManifestWithPath(projectDir);
  const config = resolveConfig({}, manifest);
  const renderDir = manifestPath ? dirname(manifestPath) : projectDir;
  const { plugins, pluginCss } = await loadPluginsWithCss(config.extensions, renderDir);
  mkdirSync(outDir, { recursive: true });

  const imageRefs: string[] = [];
  const cssAssets: AssetCopy[] = [];
  const htmlPath = await renderChaptersToFile(renderDir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
    plugins,
    pluginCss,
    onImageRefs: (refs) => imageRefs.push(...refs),
    onCssAssets: (copies) => cssAssets.push(...copies),
  });

  const { missing } = await stageBookAssets({
    renderDir,
    outDir,
    htmlFile: htmlPath,
    imageRefs,
    cssAssets,
    onPlan: ({ unresolved }) => {
      // A build REFUSES to ship these; the gate measures the book anyway —
      // where an image points is not a fragmentation question. Reported, not
      // ignored, so a fixture cannot quietly lose art the gate then blesses.
      for (const e of unresolved) console.log(`   UNRESOLVED image ref — ${e.split("\n")[0]}`);
    },
  });
  for (const m of missing)
    console.log(`   MISSING image ${m} — magenta placeholder staged, as the build does`);

  const rawHtml = await readFile(htmlPath, "utf-8");
  const { html: instrumentedHtml, ids: headingIds } = instrumentHeadingIds(rawHtml);
  await writeFile(htmlPath, instrumentedHtml, "utf-8");

  return { htmlPath, headingIds };
}

/**
 * Mount the viewer on its OWN page pinned to the same deterministic viewport
 * `build()` itself measured against (`BuildResult.viewport`) — an unpinned
 * viewport would make a page-count or per-id comparison meaningless (see
 * `build.ts`'s "deterministic viewport = the sheet" comment). The fragmented
 * document's api is left on `window.__gpParity` for the caller's evaluates.
 */
export async function mountViewer(
  browser: Browser,
  url: string,
  agentScript: string,
  viewerScript: string,
  viewport: { width: number; height: number },
): Promise<Session> {
  const page = await browser.newPage();
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Emulation.setEmulatedMedia", { media: "print" });
    await page.navigate(url);
    await page.evaluate(agentScript);
    await page.waitForReady();
    await page.evaluate(`window.__GP_MANUAL__ = true;`);
    await page.evaluate(viewerScript);
    await page.evaluate(`window.Gutterpress.fragmentDocument({}).then((api) => { window.__gpParity = api; })`);
    return page;
  } catch (err) {
    await page.close();
    throw err;
  }
}

/**
 * Independent viewer measurement (`mountViewer`). Used two ways: (a)'s Tier
 * 1/2 page-count fallback (`build()` never ran `predictPageMap` for those, so
 * there is no `predicted.pageCount` to read), and (d)'s per-heading page map,
 * which runs for every fixture regardless of tier — `predicted.pageMap` (when
 * present) is scoped to Tier 3's own target-counter() ids, not the heading
 * ids `instrumentHeadingIds` adds.
 */
async function viewerPageMap(
  browser: Browser,
  url: string,
  agentScript: string,
  viewerScript: string,
  viewport: { width: number; height: number },
  ids: string[],
): Promise<{ pageCount: number; pageMap: Record<string, number> }> {
  const page = await mountViewer(browser, url, agentScript, viewerScript, viewport);
  try {
    return await page.evaluate<{ pageCount: number; pageMap: Record<string, number> }>(
      `(() => {
        const api = window.__gpParity;
        const ids = ${JSON.stringify(ids)};
        const pageMap = {};
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el) pageMap[id] = api.pageOf(el) + 1;
        }
        return { pageCount: api.totalPages, pageMap };
      })()`,
    );
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// (e) exact-fit boundary measurement
// ---------------------------------------------------------------------------

export interface DisagreeingHeading {
  id: string;
  print: number;
  viewer: number;
  agreeingPage: number;
}

/**
 * The first heading, in document order, whose page the two fragmenters
 * disagree on (both sides measured — a one-sided MISSING stays a plain
 * divergence), plus the print page of the last heading before it that they
 * agreed on: the boundary lies on or after that page, since a heading both
 * sides put on the same page is a point where the two paginations were in
 * step.
 */
export function firstDisagreeingHeading(
  headingIds: string[],
  printMap: Record<string, number>,
  viewerMap: Record<string, number>,
): DisagreeingHeading | undefined {
  let agreeingPage = 1;
  for (const id of headingIds) {
    const print = printMap[id];
    const viewer = viewerMap[id];
    if (print === undefined || viewer === undefined) continue;
    if (print !== viewer) return { id, print, viewer, agreeingPage };
    agreeingPage = print;
  }
  return undefined;
}

export interface PrintLine {
  /** baseline, CSS px below the page's content top */
  baselinePx: number;
  text: string;
}

/**
 * One page's text runs (`getTextPass`) grouped into lines by baseline —
 * runs within 0.5pt of each other share a line, exact y kept — sorted
 * top-down and reduced to the page's content box, so running heads and
 * folios in the margins drop out. Baselines come back in CSS px below the
 * content top, the unit the viewer measures in.
 */
export function groupTextRuns(
  runs: TextRun[],
  pageHeightPt: number,
  contentTopPt: number,
  contentHeightPt: number,
): PrintLine[] {
  const lines: Array<{ yTopPt: number; runs: TextRun[] }> = [];
  for (const run of runs) {
    const yTopPt = pageHeightPt - run.y;
    const line = lines.find((l) => Math.abs(l.yTopPt - yTopPt) <= 0.5);
    if (line) line.runs.push(run);
    else lines.push({ yTopPt, runs: [run] });
  }
  return lines
    .filter((l) => l.yTopPt >= contentTopPt - 1 && l.yTopPt <= contentTopPt + contentHeightPt + 2)
    .sort((a, b) => a.yTopPt - b.yTopPt)
    .map((l) => ({
      baselinePx: (l.yTopPt - contentTopPt) * PX_PER_PT,
      text: l.runs
        .sort((a, b) => a.x - b.x)
        .map((r) => r.s)
        .join(""),
    }));
}

/**
 * The exact-fit rule (see the header): the keeping side's slack is at or
 * above the column bottom within the tolerance, the pushing side's is below
 * it, and the two differ by at most the tolerance. Opposite fit OUTCOMES are
 * what the two fragmenters actually decided; the slacks are the measured
 * geometry behind those decisions.
 */
export function classifyBoundary(keptSlackPx: number, pushedSlackPx: number): boolean {
  return (
    pushedSlackPx < 0 &&
    keptSlackPx >= -EXACT_FIT_TOLERANCE_PX &&
    Math.abs(keptSlackPx - pushedSlackPx) <= EXACT_FIT_TOLERANCE_PX
  );
}

function isExactFit(b: ExactFitBoundary): boolean {
  return b.keptBy === "print"
    ? classifyBoundary(b.printSlackPx, b.viewerSlackPx)
    : classifyBoundary(b.viewerSlackPx, b.printSlackPx);
}

/**
 * Whether a divergence can be a consequence of the boundary at the end of
 * `boundaryPage`: both sides measured the element and both put it on that
 * page or later. Everything before the disputed line is laid out the same
 * way in both fragmenters, so a divergence upstream of it — or a one-sided
 * miss, which is not a placement at all — is its own finding and still
 * counts even when the fixture's outcome is EXACT-FIT.
 */
export function isDownstream(d: Divergence, boundaryPage: number): boolean {
  return (
    d.printPage !== undefined &&
    d.viewerPage !== undefined &&
    d.printPage >= boundaryPage &&
    d.viewerPage >= boundaryPage
  );
}

/**
 * The viewer side of check (e), evaluated in a `mountViewer` page. Installs
 * `window.__gpExactFit(api)`, a set of geometry helpers over the fragmented
 * document, and `measure()`, which finds the disputed boundary and returns
 * the disputed line's box on both sides (see `measureExactFitBoundary` for
 * the inputs). Every coordinate is in the strip's own unscaled CSS px from
 * the strip's top edge — every column starts at y = 0, so a line's `bottom`
 * is also its distance from its column's top, comparable with
 * `--gp-content-h` directly.
 */
export const EXACT_FIT_BROWSER_JS = String.raw`window.__gpExactFit = function (api) {
  const BLOCK = "p,pre,li,h1,h2,h3,h4,h5,h6,td,th,dt,dd,figcaption,blockquote,div";
  const AVOID = /^avoid/;
  const norm = (t) => t.replace(/\s+/g, "").replace(/[-‐­]+$/, "");
  // How well two normalised lines agree: the shorter's length when one
  // contains the other (3 characters or more), else 0. Containment rather
  // than equality because generated content (chapter numbers, list markers)
  // is in the PDF but not in the DOM text, and a table row is one PDF line
  // but one DOM line per cell.
  const score = (a, b) =>
    a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)) ? Math.min(a.length, b.length) : 0;
  const zoomOf = (el) => el.currentCSSZoom ?? 1;
  const stripInfo = (s) => {
    const cs = getComputedStyle(s.el);
    return {
      el: s.el, rect: s.el.getBoundingClientRect(), zoom: zoomOf(s.el), offset: s.offset,
      stride: parseFloat(cs.getPropertyValue("--gp-content-w")) + (parseFloat(cs.columnGap) || 0),
      contentH: parseFloat(cs.getPropertyValue("--gp-content-h")),
    };
  };
  const stripFor = (page) => {
    const s = api.strips.find((x) => page > x.offset && page <= x.offset + x.pages);
    return s ? stripInfo(s) : null;
  };
  const stripOf = (el) => stripInfo(api.strips.find((s) => s.el.contains(el)));

  // Font metrics per (font, line-height, zoom), measured on a probe OUTSIDE
  // the document flow so nothing in the book moves: where the baseline sits
  // in a character's rect, the rect's height, and how far the line box
  // extends above and below the rect. Range rects on text are the font's
  // content area, not the line box (a 15px rect inside a 21px line for 14px
  // Georgia at 1.5) — this is what turns one into the other.
  const metrics = new Map();
  function metricsOf(el, zoom) {
    const cs = getComputedStyle(el);
    const font = ["fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily"];
    const key = font.map((p) => cs[p]).join("|") + "|" + zoom;
    let m = metrics.get(key);
    if (m) return m;
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;left:-100000px;top:0;margin:0;padding:0;border:0;white-space:pre;width:max-content";
    for (const p of font) div.style[p] = cs[p];
    div.style.zoom = String(zoom);
    const text = document.createTextNode("Hg");
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    div.append(text, mark);
    document.body.appendChild(div);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const cr = range.getClientRects()[0], dr = div.getBoundingClientRect(), mr = mark.getBoundingClientRect();
    m = { ascent: (mr.top - cr.top) / zoom, height: cr.height / zoom, above: (cr.top - dr.top) / zoom, below: (dr.bottom - cr.bottom) / zoom };
    div.remove();
    metrics.set(key, m);
    return m;
  }

  // Every rendered line of a block, in flow order: text, page (1-based),
  // line-box top/bottom and baseline. A line box is the union of the block's
  // own strut on the baseline and every character's extent.
  function linesOf(block) {
    const si = stripOf(block);
    const bm = metricsOf(block, si.zoom);
    const lines = [];
    let cur = null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      const m = metricsOf(parent, si.zoom);
      const onBaseline = parent === block || getComputedStyle(parent).verticalAlign === "baseline";
      for (let i = 0; i < node.data.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || (r.width === 0 && r.height === 0)) continue;
        const top = (r.top - si.rect.top) / si.zoom, bottom = (r.bottom - si.rect.top) / si.zoom;
        const left = (r.left - si.rect.left) / si.zoom + si.el.scrollLeft;
        // Same visual line: vertical overlap with what is there and x not
        // going back. The page comes from the line's FIRST character only —
        // an overflow-hidden <pre> lays its clipped tail out past the column
        // edge, into the next column's x-range, and that is still this line.
        if (!(cur && top < cur.glyphBottom - 0.5 && bottom > cur.glyphTop + 0.5 && left >= cur.lastLeft - 0.5)) {
          cur = { text: "", page: si.offset + Math.floor((left + 1) / si.stride) + 1, glyphTop: top, glyphBottom: bottom,
                  lastLeft: left, baseline: NaN, top: Infinity, bottom: -Infinity };
          lines.push(cur);
        }
        cur.text += node.data[i];
        cur.lastLeft = left;
        cur.glyphTop = Math.min(cur.glyphTop, top);
        cur.glyphBottom = Math.max(cur.glyphBottom, bottom);
        cur.top = Math.min(cur.top, top - m.above);
        cur.bottom = Math.max(cur.bottom, bottom + m.below);
        if (Number.isNaN(cur.baseline) && onBaseline) {
          cur.baseline = top + m.ascent;
          cur.top = Math.min(cur.top, cur.baseline - bm.ascent - bm.above);
          cur.bottom = Math.max(cur.bottom, cur.baseline + (bm.height - bm.ascent) + bm.below);
        }
      }
    }
    return lines.filter((l) => norm(l.text) && !Number.isNaN(l.baseline));
  }

  const leafBlocks = (si) => Array.from(si.el.querySelectorAll(BLOCK)).filter((el) => !el.querySelector(BLOCK));
  const onPages = (block, lo, hi) => {
    const [a, z] = api.pageRangeOf(block);
    return a + 1 <= hi && z + 1 >= lo;
  };
  // The line that ends lowest on a page ("bottom") or starts highest ("top").
  function edgeLineOnPage(si, page, edge) {
    let best = null;
    for (const block of leafBlocks(si)) {
      if (!onPages(block, page, page)) continue;
      const lines = linesOf(block);
      lines.forEach((line, k) => {
        if (line.page !== page) return;
        if (!best || (edge === "bottom" ? line.bottom > best.line.bottom : line.top < best.line.top))
          best = { block, lines, k, line };
      });
    }
    return best;
  }
  // The viewer line matching a print line's (normalised) text on pages lo..hi.
  function locateLine(si, want, lo, hi) {
    let best = null;
    for (const block of leafBlocks(si)) {
      if (!onPages(block, lo, hi)) continue;
      const whole = norm(block.textContent);
      if (!(whole.includes(want) || want.includes(whole))) continue;
      const lines = linesOf(block);
      lines.forEach((line, k) => {
        const s = score(norm(line.text), want);
        if (s > 0 && (!best || s > best.score)) best = { block, lines, k, line, score: s };
      });
    }
    return best;
  }
  // Take the break rules off everything the viewer pushed past page lo, up
  // to and including the disputed line's block (and the break-before of
  // whatever follows it), so a relayout shows where the viewer's GEOMETRY
  // puts the line rather than where its orphans/avoid rules moved it.
  // Forced breaks are left alone; only avoid* values are neutralised.
  function neutraliseChain(si, block, lo) {
    for (const el of si.el.querySelectorAll("*")) {
      const upTo = el === block || (el.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (!upTo || (el !== block && api.pageOf(el) + 1 <= lo)) continue;
      const cs = getComputedStyle(el);
      for (const p of ["breakBefore", "breakAfter", "breakInside"]) if (AVOID.test(cs[p])) el.style[p] = "auto";
      el.style.orphans = "1";
      el.style.widows = "1";
    }
    const walker = document.createTreeWalker(si.el, NodeFilter.SHOW_ELEMENT);
    walker.currentNode = block;
    let next;
    while ((next = walker.nextNode()) && block.contains(next));
    if (next && AVOID.test(getComputedStyle(next).breakBefore)) next.style.breakBefore = "auto";
  }

  // input: { lo, agreeingPage, headingIds, printLines: { [page]: [{ text, baselinePx }] } }
  function measure(input) {
    const { lo, agreeingPage, headingIds, printLines } = input;
    const pagesBefore = {};
    for (const id of headingIds) {
      const el = document.getElementById(id);
      if (el) pagesBefore[id] = api.pageOf(el) + 1;
    }
    // The boundary page: the first page whose LAST line the two sides disagree on.
    let found = null;
    for (let q = agreeingPage; q <= lo && !found; q++) {
      const printPage = printLines[q] || [];
      if (!printPage.length) continue;
      const si = stripFor(q);
      if (!si) return { error: "no viewer strip covers p" + q };
      const lastPrint = printPage[printPage.length - 1];
      const loc = locateLine(si, norm(lastPrint.text), q, q + 1);
      if (!loc) return { error: "print's last line on p" + q + " (" + JSON.stringify(lastPrint.text.slice(0, 40)) + ") was not found in the viewer" };
      if (loc.line.page > q) found = { q, si, keptBy: "print", D: loc, printLine: lastPrint };
      else if (loc.line.page < q) return { error: "print's last line on p" + q + " sits on p" + loc.line.page + " in the viewer" };
      else {
        const lastViewer = edgeLineOnPage(si, q, "bottom");
        if (!lastViewer) return { error: "no viewer line on p" + q };
        const nv = norm(lastViewer.line.text);
        if (score(nv, norm(lastPrint.text)) > 0) continue; // both pages end on the same line
        if ((printLines[q + 1] || []).some((l) => score(nv, norm(l.text)) > 0))
          found = { q, si, keptBy: "viewer", D: lastViewer, L: loc, printLine: lastPrint };
        else return { error: "p" + q + " ends on different lines and the viewer's (" + JSON.stringify(lastViewer.line.text.slice(0, 40)) + ") is not on print's p" + (q + 1) };
      }
    }
    if (!found) return { error: "no page between p" + agreeingPage + " and p" + lo + " ends on different lines" };
    const { q: b, keptBy, D } = found;
    const common = { page: b, keptBy, text: D.line.text.trim(), block: D.block.tagName.toLowerCase(),
                     lineIndex: D.k + 1, lineCount: D.lines.length, contentHPx: found.si.contentH };
    if (keptBy === "viewer") {
      // Print pushed D: project print's baseline for it from print's last
      // kept line L, carrying the viewer's own L->D distance.
      const L = found.L.line;
      const printBaselinePx = found.printLine.baselinePx + (D.line.baseline - L.baseline);
      return { ...common, printBaselinePx, printBottomPx: printBaselinePx + (D.line.bottom - D.line.baseline),
               viewerBaselinePx: D.line.baseline, viewerBottomPx: D.line.bottom };
    }
    // Print kept D: expose the viewer's geometry, then project D back onto
    // page b under the viewer's own last kept line.
    neutraliseChain(found.si, D.block, b);
    api.relayout();
    for (const id of Object.keys(pagesBefore)) {
      if (pagesBefore[id] <= b && api.pageOf(document.getElementById(id)) + 1 !== pagesBefore[id])
        return { error: "neutralising the pushed chain moved heading " + id + " upstream of p" + b };
    }
    const si = stripFor(b);
    const Dl = linesOf(D.block)[D.k];
    if (!Dl) return { error: "the disputed line vanished on relayout" };
    if (Dl.page <= b)
      return { error: "the viewer fits " + JSON.stringify(Dl.text.trim().slice(0, 40)) + " on p" + b + " once its break rules are neutralised — a break-rule disagreement, not geometry" };
    const kept = edgeLineOnPage(si, b, "bottom");
    const first = edgeLineOnPage(si, b + 1, "top");
    if (!kept || !first) return { error: "no viewer line on p" + (kept ? b + 1 : b) + " after relayout" };
    let gap = 0;
    if (kept.block !== first.block) {
      // between two blocks: the kept block's bottom padding/border on page
      // b, then the collapsed margin; the first block's top padding/border
      // is already inside Dl.bottom, its top margin truncated at the break
      const col = b - si.offset - 1;
      const frag = Array.from(kept.block.getClientRects()).find(
        (r) => Math.floor(((r.left - si.rect.left) / si.zoom + si.el.scrollLeft + 1) / si.stride) === col);
      const fragBottom = ((frag || kept.block.getBoundingClientRect()).bottom - si.rect.top) / si.zoom;
      gap = fragBottom - kept.line.bottom +
        Math.max(parseFloat(getComputedStyle(kept.block).marginBottom), parseFloat(getComputedStyle(first.block).marginTop));
    }
    const viewerBottomPx = kept.line.bottom + gap + Dl.bottom;
    const tail = Dl.bottom - Dl.baseline;
    return { ...common, printBaselinePx: found.printLine.baselinePx, printBottomPx: found.printLine.baselinePx + tail,
             viewerBaselinePx: viewerBottomPx - tail, viewerBottomPx };
  }
  return { linesOf, measure };
};`;

interface StripGeometry {
  offset: number;
  pages: number;
  marginTopPx: number;
  contentHPx: number;
}

type ViewerMeasurement =
  | { error: string }
  | Omit<ExactFitBoundary, "headingId" | "headingPrintPage" | "headingViewerPage" | "printSlackPx" | "viewerSlackPx" | "deltaPx">;

/**
 * Check (e): measure the first disputed page boundary in both fragmenters.
 * Print lines come from the PDF's text runs, the viewer's from a fresh
 * `mountViewer` of the same document (the measurement relays the viewer out
 * with its break rules neutralised, so it never shares (d)'s mount). Returns
 * the boundary's numbers, or the reason it could not be measured — which
 * leaves the fixture a divergence, exactly as before this check existed.
 * Never throws: a failure inside the measurement (the PDF not parsing, the
 * browser-side script raising) is a reason too, and the fixture's own
 * divergence list must still be reported.
 */
export async function measureExactFitBoundary(
  browser: Browser,
  url: string,
  agentScript: string,
  viewerScript: string,
  viewport: { width: number; height: number },
  headingIds: string[],
  first: DisagreeingHeading,
  pdfBytes: Uint8Array,
): Promise<ExactFitBoundary | { error: string }> {
  const lo = Math.min(first.print, first.viewer);
  let doc: PDFDocumentProxy | undefined;
  let page: Session | undefined;
  try {
    // A copy: pdf.js may take the buffer over, and `result.bytes` is the build's.
    doc = await getDocumentProxy(new Uint8Array(pdfBytes));
    page = await mountViewer(browser, url, agentScript, viewerScript, viewport);
    await page.evaluate(EXACT_FIT_BROWSER_JS);
    const strips = await page.evaluate<StripGeometry[]>(
      `window.__gpParity.strips.map((s) => {
        const cs = getComputedStyle(s.el);
        return { offset: s.offset, pages: s.pages,
          marginTopPx: parseFloat(cs.getPropertyValue("--gp-margin-top")),
          contentHPx: parseFloat(cs.getPropertyValue("--gp-content-h")) };
      })`,
    );
    const textPass = await getTextPass(doc);
    const printLines: Record<number, PrintLine[]> = {};
    for (let q = first.agreeingPage; q <= lo + 1 && q <= doc.numPages; q++) {
      const strip = strips.find((s) => q > s.offset && q <= s.offset + s.pages);
      if (!strip) continue;
      const { h } = getPageSize(await doc.getPage(q));
      printLines[q] = groupTextRuns(
        textPass.runsByPage[q - 1] ?? [],
        h,
        strip.marginTopPx / PX_PER_PT,
        strip.contentHPx / PX_PER_PT,
      );
    }
    const measured = await page.evaluate<ViewerMeasurement>(
      `window.__gpExactFit(window.__gpParity).measure(${JSON.stringify({
        lo,
        agreeingPage: first.agreeingPage,
        headingIds,
        printLines,
      })})`,
    );
    if ("error" in measured) return measured;
    const printSlackPx = measured.contentHPx - measured.printBottomPx;
    const viewerSlackPx = measured.contentHPx - measured.viewerBottomPx;
    return {
      ...measured,
      headingId: first.id,
      headingPrintPage: first.print,
      headingViewerPage: first.viewer,
      printSlackPx,
      viewerSlackPx,
      deltaPx:
        measured.keptBy === "print" ? printSlackPx - viewerSlackPx : viewerSlackPx - printSlackPx,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page?.close();
    await doc?.destroy();
  }
}

const px = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}px`;

function printExactFit(report: FixtureReport) {
  const b = report.exactFit!;
  if ("error" in b) {
    console.log(`   NOTE exact-fit measurement: ${b.error} — the divergences below stand`);
    return;
  }
  const side = (name: string, baseline: number, bottom: number, slack: number) =>
    `     ${name.padEnd(6)} baseline ${baseline.toFixed(2)}px, line box ends ${bottom.toFixed(2)}px of ${b.contentHPx}px — slack ${px(slack)}`;
  const kept = b.keptBy === "print" ? "print kept the line, the preview pushed it" : "the preview kept the line, print pushed it";
  const head = report.outcome === "exact-fit" ? "EXACT-FIT BOUNDARY" : "NOTE exact-fit measurement";
  console.log(
    `   ${head} at p${b.page} — ${kept} (first differing heading ${b.headingId}: print=p${b.headingPrintPage} viewer=p${b.headingViewerPage})`,
  );
  console.log(`     line   ${JSON.stringify(b.text.length > 60 ? b.text.slice(0, 57) + "…" : b.text)} (${b.block}, line ${b.lineIndex} of ${b.lineCount})`);
  console.log(side("print", b.printBaselinePx, b.printBottomPx, b.printSlackPx));
  console.log(side("viewer", b.viewerBaselinePx, b.viewerBottomPx, b.viewerSlackPx));
  console.log(
    `     delta  ${b.deltaPx.toFixed(2)}px (tolerance ${EXACT_FIT_TOLERANCE_PX}px) — ` +
      (report.outcome === "exact-fit"
        ? `${downstreamCount(report)} downstream divergence(s) listed for information, not counted` +
          (downstreamCount(report) < report.divergences.length
            ? `; the ${report.divergences.length - downstreamCount(report)} not downstream of p${b.page} still count:`
            : ":")
        : `not an exact-fit boundary; the divergences below stand`),
  );
}

function downstreamCount(report: FixtureReport): number {
  const b = report.exactFit as ExactFitBoundary;
  return report.divergences.filter((d) => isDownstream(d, b.page)).length;
}

interface FixtureReport {
  fixture: string;
  tier: 1 | 2 | 3;
  printPages: number;
  viewerPages: number;
  instrumentedIds: number;
  headingIds: number;
  divergences: Divergence[];
  outcome: FixtureOutcome;
  /** check (e)'s measurement (or why it could not classify), when (d) disagreed */
  exactFit?: ExactFitBoundary | { error: string };
}

async function runFixture(
  browser: Browser,
  name: string,
  projectDir: string,
  agentScript: string,
  viewerScript: string,
): Promise<FixtureReport> {
  const stageDir = join(WORK, name);
  const { htmlPath, headingIds } = await stage(projectDir, stageDir);
  // allowShrink: true — this gate measures FRAGMENTER parity, not content
  // print-quality. A pre-existing width-overflow in a fixture book is a real
  // (separate) finding, not this gate's concern; downgrading it to a warning
  // (never rewriting the fixture's content) lets both fragmenters run so
  // their page maps can still be compared, exactly like the migration
  // spike's `--skip-pre-validate` on the same class of pre-existing issue.
  const result: BuildResult = await build({ input: htmlPath, browser, allowShrink: true });
  // …but say so loudly: a shrunk print is laid out at the OFFENDING width and
  // scaled to fit, so it fits ~1/scale² more content per page than the viewer,
  // which never shrinks. Measured on design-guide: one 818px `code` line made
  // print 42pp against the viewer's 53pp — a divergence that looks like a
  // fragmenter bug and is not one.
  if (result.diagnostics.some((d) => d.code === "engine.width.overflow"))
    console.log(
      `   NOTE width overflow — Chromium shrank this print to fit; page counts below are NOT comparable`,
    );
  const divergences: Divergence[] = [];
  const url = pathToFileURL(htmlPath).href;

  // ---- (d) per-heading page map, every fixture regardless of tier -------
  // Runs before (a) so a Tier 1/2 book's page-count fallback can reuse this
  // same viewer mount instead of paying for a second one.
  const headingMeasurement = await viewerPageMap(
    browser,
    url,
    agentScript,
    viewerScript,
    result.viewport,
    headingIds,
  );
  const printFacts = await inspectPdf(result.bytes);
  const printHeadingMap: Record<string, number> = {};
  for (const id of headingIds) {
    const dest = printFacts.namedDests[id];
    if (dest !== undefined) printHeadingMap[id] = dest + 1;
  }
  for (const id of headingIds) {
    const printed = printHeadingMap[id];
    const viewed = headingMeasurement.pageMap[id];
    // Missing on both sides just means Chromium didn't resolve a /Dest for
    // this id (e.g. a duplicate id elsewhere in the document) — not a
    // fragmenter divergence, so only flag a ONE-sided miss or an outright
    // mismatch.
    if (printed === undefined && viewed === undefined) continue;
    if (printed === undefined || viewed === undefined) {
      divergences.push({
        fixture: name,
        kind: "headingPageMap",
        detail: `id=${id} print=${printed ?? "MISSING"} viewer=${viewed ?? "MISSING"}`,
      });
      continue;
    }
    if (printed !== viewed) {
      divergences.push({
        fixture: name,
        kind: "headingPageMap",
        detail: `id=${id} print=p${printed} viewer=p${viewed}`,
        printPage: printed,
        viewerPage: viewed,
      });
    }
  }

  // ---- (a) total page count --------------------------------------------
  const viewerPages = result.predicted ? result.predicted.pageCount : headingMeasurement.pageCount;
  if (viewerPages !== result.pageCount) {
    divergences.push({
      fixture: name,
      kind: "pageCount",
      detail: `viewer=${viewerPages}pp print=${result.pageCount}pp`,
      printPage: result.pageCount,
      viewerPage: viewerPages,
    });
  }

  let instrumentedIds = 0;
  // ---- (b) page-of-element map, (c) resolved target-counter() values ----
  if (result.predicted) {
    const ids = new Set([...Object.keys(result.pageMap), ...Object.keys(result.predicted.pageMap)]);
    instrumentedIds = ids.size;
    const printedValues = restartedPageValues(result.resetSites, result.pageMap, result.pageCount);
    const viewedValues = restartedPageValues(
      result.resetSites,
      result.predicted.pageMap,
      result.predicted.pageCount,
    );
    for (const id of ids) {
      const printed = result.pageMap[id];
      const viewed = result.predicted.pageMap[id];
      if (printed === undefined || viewed === undefined) {
        divergences.push({
          fixture: name,
          kind: "pageMap",
          detail: `id=${id} print=${printed ?? "MISSING"} viewer=${viewed ?? "MISSING"}`,
        });
        continue;
      }
      if (printed !== viewed) {
        divergences.push({
          fixture: name,
          kind: "pageMap",
          detail: `id=${id} print=p${printed} viewer=p${viewed}`,
          printPage: printed,
          viewerPage: viewed,
        });
      }
      const printedFolio = toFolioPage(printed, printedValues);
      const viewedFolio = toFolioPage(viewed, viewedValues);
      if (printedFolio !== viewedFolio) {
        divergences.push({
          fixture: name,
          kind: "targetCounter",
          detail: `id=${id} target-counter() print=${printedFolio} viewer=${viewedFolio}`,
          printPage: printed,
          viewerPage: viewed,
        });
      }
    }
  }

  // ---- (e) exact-fit boundary, only when (d) disagreed ------------------
  let outcome: FixtureOutcome = divergences.length ? "divergence" : "clean";
  let exactFit: FixtureReport["exactFit"];
  const first = firstDisagreeingHeading(headingIds, printHeadingMap, headingMeasurement.pageMap);
  if (first) {
    exactFit = await measureExactFitBoundary(
      browser,
      url,
      agentScript,
      viewerScript,
      result.viewport,
      headingIds,
      first,
      result.bytes,
    );
    if (!("error" in exactFit) && isExactFit(exactFit)) outcome = "exact-fit";
  }

  return {
    fixture: name,
    tier: result.tier,
    printPages: result.pageCount,
    viewerPages,
    instrumentedIds,
    headingIds: headingIds.length,
    divergences,
    outcome,
    exactFit,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const requested = (args.length ? args : DEFAULT_FIXTURES).map((p) => resolve(p));
  // Two default fixtures live outside the repo (/tmp scratch books), so on a
  // fresh clone or in CI they are simply absent — skipping them keeps the
  // in-repo fixtures meaningful instead of failing the gate for a reason that
  // has nothing to do with parity. An explicitly named dir is never skipped.
  const missing = requested.filter((dir) => !existsSync(dir));
  if (missing.length) {
    // A skipped fixture used to print SKIP and still let the run report PASS,
    // so coverage could vanish silently — two absolute /tmp paths sat in the
    // default list unnoticed. Every registered fixture must exist.
    for (const dir of missing) console.error(`   MISSING FIXTURE ${dir}`);
    console.error(`\n${missing.length} fixture(s) missing — gate FAILS.`);
    process.exit(1);
  }
  const fixtures = requested;
  if (!fixtures.length) {
    console.log("No fixtures available to measure — nothing was checked.");
    process.exit(1);
  }
  mkdirSync(WORK, { recursive: true });

  const AGENT = await readFile(await getAssetPath("engine/gutterpress-agent.js"), "utf8");
  const VIEWER = await readFile(await getAssetPath("engine/gutterpress-viewer.js"), "utf8");

  const browser = await launchChromium();
  const reports: FixtureReport[] = [];
  try {
    for (const dir of fixtures) {
      // A docs/fixtures/<name>/book fixture is named <name>, not `book`.
      const parts = dir.replace(/\/+$/, "").split("/");
      const leaf = parts.pop()!;
      const name = leaf === "book" ? parts.pop()! : leaf;
      console.log(`\n== ${name} (${dir})`);
      try {
        const report = await runFixture(browser, name, dir, AGENT, VIEWER);
        reports.push(report);
        console.log(
          `   tier ${report.tier}, print ${report.printPages}pp / viewer ${report.viewerPages}pp, ` +
            `${report.instrumentedIds} target-counter id(s), ${report.headingIds} heading id(s), ` +
            `${report.divergences.length} divergence(s)`,
        );
        if (report.exactFit) printExactFit(report);
        for (const d of report.divergences) console.log(`     [${d.kind}] ${d.detail}`);
      } catch (err) {
        console.log(`   BUILD FAILED: ${err instanceof Error ? err.message : String(err)}`);
        reports.push({
          fixture: name,
          tier: 1,
          printPages: -1,
          viewerPages: -1,
          instrumentedIds: 0,
          headingIds: 0,
          divergences: [{ fixture: name, kind: "pageCount", detail: "build failed, see log above" }],
          outcome: "divergence",
        });
      }
    }
  } finally {
    await browser.close();
  }

  // ---- allowlist check ---------------------------------------------------
  console.log("\n== summary");
  let unexpected = 0;
  for (const report of reports) {
    const boundary = report.outcome === "exact-fit" ? (report.exactFit as ExactFitBoundary) : undefined;
    if (boundary) {
      console.log(
        `   EXACT-FIT   [${report.fixture}] p${boundary.page} print ${px(boundary.printSlackPx)} / viewer ${px(boundary.viewerSlackPx)} ` +
          `(delta ${boundary.deltaPx.toFixed(2)}px) — ${downstreamCount(report)} downstream divergence(s) not counted`,
      );
    }
    for (const d of report.divergences) {
      if (boundary && isDownstream(d, boundary.page)) continue;
      const known = isKnown(d);
      if (known) {
        console.log(`   ALLOWLISTED [${report.fixture}/${d.kind}] ${d.detail} — ${known.reason}`);
      } else {
        console.log(`   UNEXPECTED  [${report.fixture}/${d.kind}] ${d.detail}`);
        unexpected++;
      }
    }
  }
  // Only fixtures this run actually measured can say anything about whether an
  // allowlisted divergence is gone; a skipped one has no opinion.
  const knownButAbsent = KNOWN_DIVERGENCES.filter(
    (k) =>
      reports.some((r) => r.fixture === k.fixture) &&
      !reports.some((r) => r.fixture === k.fixture && r.divergences.some((d) => d.kind === k.kind)),
  );
  for (const k of knownButAbsent)
    console.log(`   NOTE: allowlisted divergence [${k.fixture}/${k.kind}] did not reproduce this run — parity improved, update KNOWN_DIVERGENCES.`);

  const clean = reports.filter((r) => r.outcome === "clean").length;
  const exact = reports.filter((r) => r.outcome === "exact-fit").length;
  console.log(
    `\n${clean} clean, ${exact} exact-fit boundary(ies), ${unexpected} unexpected divergence(s) — ` +
      (unexpected > 0 ? "gate FAILS." : "gate PASSES."),
  );
  if (unexpected > 0) process.exit(1);
}

if (import.meta.main) await main();
