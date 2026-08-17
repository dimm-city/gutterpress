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
 * prints beyond what a real `gutterpress build --engine native` already
 * pays for):
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
 * A Tier 1/2 book (no `predicted` map — nothing was instrumented for target-
 * counter() purposes) still gets (a): a second, independent viewer mount
 * (this script's own `viewerPageMap`), pinned to the exact same `viewport`
 * the build itself measured against, so a page-count mismatch is a real
 * fragmentation divergence, not an artifact of an unpinned viewport.
 *
 * Any divergence must be an explicit entry in KNOWN_DIVERGENCES with a
 * reason, following the migration spike's own pattern
 * (the same KNOWN_DIVERGENCES pattern the retired migration-fixtures harness used — see docs/engine-history/MIGRATION.md) — never a
 * silent tolerance. An unlisted divergence fails the run (exit 1).
 *
 * Usage:
 *   bun scripts/native-parity-gate.ts
 *   bun scripts/native-parity-gate.ts <project-dir> [<project-dir> ...]
 */
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChromium, type Browser } from "../src/engine/shared/cdp.ts";
import { build, type BuildResult } from "../src/engine/compiler/build.ts";
import { restartedPageValues, toFolioPage } from "../src/engine/shared/synthesis.ts";
import { inspectPdf } from "../src/engine/shared/pdf-inspect.ts";
import { loadManifestWithPath, resolveConfig } from "../src/lib/manifest.ts";
import { renderChaptersToFile } from "../src/lib/markdown/index.ts";
import { loadPluginsWithCss } from "../src/lib/markdown/plugins.ts";
import { planImageCopies, type AssetCopy } from "../src/lib/asset-inline.ts";
import { getAssetPath } from "../src/lib/embedded-assets.ts";

const REPO = resolve(import.meta.dir, "..", "..", "..");
const WORK = process.env.GUTTERPRESS_PARITY_DIR ?? "/tmp/gutterpress-parity";

/**
 * Every fixture is IN-REPO and every one is required.
 *
 * Two defaults used to be `/tmp` scratch books (`/tmp/fbtest/book`,
 * `/tmp/fg-proof-parent/field-guide`). They existed on one machine, were
 * absent everywhere else, and the runner skipped them with a log line — so
 * 2 of 7 fixtures silently contributed nothing and the gate still reported
 * PASS. A gate that quietly measures less than it claims is worse than no
 * gate; that is the exact failure this script exists to prevent, so a
 * missing fixture is now a hard error (see `main()`).
 */
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
  // The user guide is the largest first-party book (tier 3) and the only
  // default fixture with enough ordinary long-form prose to catch a
  // fragmentation drift that accumulates over many pages rather than showing
  // up on page 1. It was absent from this list while the gate ran nowhere,
  // which is how it came to carry an unnoticed viewer-vs-print divergence.
  // Its page and heading counts are deliberately not written down here: the
  // guide is edited like any other book, and a comment citing them would be
  // wrong the next time somebody adds a paragraph to it. The run prints both.
  join(REPO, "examples", "gutterpress-user-guide"),
];

type DivergenceKind = "pageCount" | "pageMap" | "targetCounter" | "headingPageMap";

interface Divergence {
  fixture: string;
  kind: DivergenceKind;
  detail: string;
}

/**
 * Explicit allowlist (the same KNOWN_DIVERGENCES pattern the retired migration-fixtures harness used, see docs/engine-history/MIGRATION.md):
 * KNOWN_DIVERGENCES pattern: every entry names exactly what it excuses and
 * why. A divergence NOT matched here fails the run. Empty until a real,
 * understood divergence is found — see this script's own report output for
 * what was actually observed on this run.
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
// -> renderChaptersToFile -> planImageCopies -> copy), forced to
// `engine: "native"` regardless of the project's own manifest so every
// fixture is staged as a real native-engine book would be. Also instruments
// every heading (`instrumentHeadingIds`) so check (d) has stable ids to
// compare, in every fixture regardless of tier.
// ---------------------------------------------------------------------------
async function stage(
  projectDir: string,
  outDir: string,
): Promise<{ htmlPath: string; headingIds: string[] }> {
  const { manifest, manifestPath } = await loadManifestWithPath(projectDir);
  const config = resolveConfig({ engine: "native" }, manifest);
  const renderDir = manifestPath ? dirname(manifestPath) : projectDir;
  const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, renderDir);
  mkdirSync(outDir, { recursive: true });

  const imageRefs: string[] = [];
  const cssAssets: AssetCopy[] = [];
  const htmlPath = await renderChaptersToFile(renderDir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
    plugins,
    pluginCss,
    engine: "native",
    onImageRefs: (refs) => imageRefs.push(...refs),
    onCssAssets: (copies) => cssAssets.push(...copies),
  });

  const { copies: imageCopies, errors } = await planImageCopies(renderDir, imageRefs);
  if (errors.length)
    console.error(`    ${errors.length} unresolved image reference(s) (ignored, not this gate's concern):`);
  const copies = [...cssAssets, ...imageCopies];
  await Promise.all(
    copies.map(async (c) => {
      const dest = join(outDir, c.to);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(c.from, dest);
    }),
  );

  const rawHtml = await readFile(htmlPath, "utf-8");
  const { html: instrumentedHtml, ids: headingIds } = instrumentHeadingIds(rawHtml);
  await writeFile(htmlPath, instrumentedHtml, "utf-8");

  return { htmlPath, headingIds };
}

/**
 * Independent viewer measurement, run on its OWN page pinned to the same
 * deterministic viewport `build()` itself measured against
 * (`BuildResult.viewport`) — an unpinned viewport would make a page-count or
 * per-id comparison meaningless (see `build.ts`'s "deterministic viewport =
 * the sheet" comment). Used two ways: (a)'s Tier 1/2 page-count fallback
 * (`build()` never ran `predictPageMap` for those, so there is no
 * `predicted.pageCount` to read), and (d)'s per-heading page map, which runs
 * for every fixture regardless of tier — `predicted.pageMap` (when present)
 * is scoped to Tier 3's own target-counter() ids, not the heading ids
 * `instrumentHeadingIds` adds.
 */
async function viewerPageMap(
  browser: Browser,
  url: string,
  agentScript: string,
  viewerScript: string,
  viewport: { width: number; height: number },
  ids: string[],
): Promise<{ pageCount: number; pageMap: Record<string, number> }> {
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
    return await page.evaluate<{ pageCount: number; pageMap: Record<string, number> }>(
      `(async () => {
        const api = await window.Gutterpress.fragmentDocument({});
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

interface FixtureReport {
  fixture: string;
  tier: 1 | 2 | 3;
  printPages: number;
  viewerPages: number;
  instrumentedIds: number;
  headingIds: number;
  divergences: Divergence[];
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
        });
      }
      const printedFolio = toFolioPage(printed, printedValues);
      const viewedFolio = toFolioPage(viewed, viewedValues);
      if (printedFolio !== viewedFolio) {
        divergences.push({
          fixture: name,
          kind: "targetCounter",
          detail: `id=${id} target-counter() print=${printedFolio} viewer=${viewedFolio}`,
        });
      }
    }
  }

  return {
    fixture: name,
    tier: result.tier,
    printPages: result.pageCount,
    viewerPages,
    instrumentedIds,
    headingIds: headingIds.length,
    divergences,
  };
}

/**
 * Stable, COLLISION-FREE report label per fixture.
 *
 * The label is not cosmetic: it names the fixture's staging directory
 * (`join(WORK, label)`) and it is what `KNOWN_DIVERGENCES.fixture` matches on.
 * A bare basename gave two different books the same label — `book`, from
 * `docs/fixtures/css-authoring-spike/book` and
 * `docs/fixtures/gp-image-positioning/book`. That made them share one staging
 * directory AND made a single allowlist entry silently excuse divergences in
 * both. Duplicated basenames get enough parent segments prepended to become
 * unique; a unique basename is left alone so existing labels do not churn.
 */
export function fixtureLabels(dirs: string[]): string[] {
  const segs = dirs.map((d) => d.replace(/\/+$/, "").split("/").filter(Boolean));
  const labels = segs.map((s) => s.at(-1)!);
  for (let depth = 2; ; depth++) {
    const counts = new Map<string, number>();
    for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([l]) => l);
    if (!dupes.length) return labels;
    let grew = false;
    for (let i = 0; i < labels.length; i++) {
      if (!dupes.includes(labels[i]!)) continue;
      const next = segs[i]!.slice(-depth).join("/");
      if (next !== labels[i]) {
        labels[i] = next;
        grew = true;
      }
    }
    // Ran out of parent segments to disambiguate with (identical paths).
    if (!grew) return labels;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fixtures = (args.length ? args : DEFAULT_FIXTURES).map((p) => resolve(p));
  // NEVER skip. Every fixture is in-repo, so an absent one means a bad path or
  // a deleted book, not a machine difference — and a gate that drops coverage
  // while still printing PASS is precisely the failure mode this script is
  // supposed to catch in the renderers.
  const missing = fixtures.filter((dir) => !existsSync(dir));
  if (missing.length) {
    console.error("Fixture(s) not found — refusing to measure a partial set:");
    for (const dir of missing) console.error(`   MISSING ${dir}`);
    process.exit(1);
  }
  if (!fixtures.length) {
    console.error("No fixtures requested — nothing was checked.");
    process.exit(1);
  }
  mkdirSync(WORK, { recursive: true });

  const AGENT = await readFile(await getAssetPath("engine/gutterpress-agent.js"), "utf8");
  const VIEWER = await readFile(await getAssetPath("engine/gutterpress-viewer.js"), "utf8");

  const browser = await launchChromium();
  const reports: FixtureReport[] = [];
  try {
    const labels = fixtureLabels(fixtures);
    for (const [i, dir] of fixtures.entries()) {
      const name = labels[i]!;
      console.log(`\n== ${name} (${dir})`);
      try {
        const report = await runFixture(browser, name, dir, AGENT, VIEWER);
        reports.push(report);
        console.log(
          `   tier ${report.tier}, print ${report.printPages}pp / viewer ${report.viewerPages}pp, ` +
            `${report.instrumentedIds} target-counter id(s), ${report.headingIds} heading id(s), ` +
            `${report.divergences.length} divergence(s)`,
        );
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
    for (const d of report.divergences) {
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

  if (unexpected > 0) {
    console.log(`\n${unexpected} unexpected divergence(s) — gate FAILS.`);
    process.exit(1);
  }
  console.log(`\nAll divergences accounted for — gate PASSES.`);
}

// Only run when executed directly (`bun scripts/native-parity-gate.ts`).
// Without this guard, importing anything from this module — e.g. a unit test
// for `fixtureLabels` — would launch Chromium and build every fixture book.
if (import.meta.main) await main();
