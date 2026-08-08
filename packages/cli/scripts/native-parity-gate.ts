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
 *       resets to instrument) — a Tier 1/2 book instruments nothing, so this
 *       check is vacuously empty for it and (a) is the only signal.
 *   (c) resolved `target-counter()` values — both page maps run through the
 *       SAME conversion the compiler itself uses to turn a physical page
 *       into the folio a `target-counter()` reference actually prints
 *       (`restartedPageValues` + `toFolioPage`, `shared/synthesis.ts`), so a
 *       counter-reset restart is honored on both sides identically.
 *
 * A Tier 1/2 book (no `predicted` map — nothing was instrumented) still gets
 * (a): a second, independent viewer mount (this script's own
 * `viewerPageCount`), pinned to the exact same `viewport` the build itself
 * measured against, so a page-count mismatch is a real fragmentation
 * divergence, not an artifact of an unpinned viewport.
 *
 * Any divergence must be an explicit entry in KNOWN_DIVERGENCES with a
 * reason, following the migration spike's own pattern
 * (`spike/folio/fixtures/migration/runner.ts`'s KNOWN_DIVERGENCES) — never a
 * silent tolerance. An unlisted divergence fails the run (exit 1).
 *
 * Usage:
 *   bun scripts/native-parity-gate.ts
 *   bun scripts/native-parity-gate.ts <project-dir> [<project-dir> ...]
 */
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChromium, type Browser } from "../src/engine/shared/cdp.ts";
import { build, type BuildResult } from "../src/engine/compiler/build.ts";
import { restartedPageValues, toFolioPage } from "../src/engine/shared/synthesis.ts";
import { loadManifestWithPath, resolveConfig } from "../src/lib/manifest.ts";
import { renderChaptersToFile } from "../src/lib/markdown/index.ts";
import { loadPluginsWithCss } from "../src/lib/markdown/plugins.ts";
import { planImageCopies, type AssetCopy } from "../src/lib/asset-inline.ts";
import { getAssetPath } from "../src/lib/embedded-assets.ts";

const REPO = resolve(import.meta.dir, "..", "..", "..");
const WORK = process.env.GUTTERPRESS_PARITY_DIR ?? "/tmp/gutterpress-parity";

const DEFAULT_FIXTURES = [
  "/tmp/fbtest/book",
  "/tmp/fg-proof-parent/field-guide",
  // examples/with-design-guide is 3 separate manifests, not one book — run
  // all 3 so the gate covers the whole example, not an arbitrary pick.
  join(REPO, "examples", "with-design-guide", "book-01"),
  join(REPO, "examples", "with-design-guide", "book-02"),
  join(REPO, "examples", "with-design-guide", "design-guide"),
];

type DivergenceKind = "pageCount" | "pageMap" | "targetCounter";

interface Divergence {
  fixture: string;
  kind: DivergenceKind;
  detail: string;
}

/**
 * Explicit allowlist, `spike/folio/fixtures/migration/runner.ts`'s
 * KNOWN_DIVERGENCES pattern: every entry names exactly what it excuses and
 * why. A divergence NOT matched here fails the run. Empty until a real,
 * understood divergence is found — see this script's own report output for
 * what was actually observed on this run.
 */
const KNOWN_DIVERGENCES: Array<{
  fixture: string;
  kind: DivergenceKind;
  reason: string;
}> = [
  // UPDATE 2026-08-08: the ORIGINAL root cause named here — fragment.ts
  // resolving one page name per `.folio-strip` from whichever descendant
  // first requested a named page, applying `page: chapter`'s oversized
  // opener margins to the WHOLE chapter run (59pp) instead of only the
  // opener fragment — is FIXED (`explodeChildren` in fragment.ts: a child
  // with no page assignment of its own but a page-changing descendant is
  // recursively split into synthetic sibling shells, so the opener element
  // gets its own run/strip at the named geometry and the rest of the run
  // reverts to the default geometry, matching Chromium print's box-level
  // `page` semantics). That took design-guide from 59pp to 53pp.
  //
  // A SECOND, unrelated, pre-existing divergence remains and accounts for
  // the rest of the gap (53pp vs print's 42pp): `pre code` in guide.css sets
  // an explicit `font-size: 9pt; line-height: 1.5` (both on `pre code`
  // itself, not inherited) — this SHOULD compute an 18px line box (12px ×
  // 1.5). Measured directly (`code.getClientRects()`), the viewer instead
  // renders 22px between lines — the SAME 22px `1.5 × 14.667px` you get from
  // `pre`'s own INHERITED font-size (11pt, from `body`), not `code`'s own
  // 12px. Confirmed NOT caused by fragment.ts or any code in this repo: it
  // reproduces on a completely vanilla `page.navigate()` with
  // `Emulation.setEmulatedMedia({media:"print"})` and ZERO viewer/agent
  // script injected. The real print page (`Page.printToPDF`, measured via
  // `pdftotext -bbox` glyph y-coordinates on the built PDF) uses the
  // CORRECT ~17.5px spacing. So this is a Chromium quirk specific to
  // `Emulation.setEmulatedMedia("print")` on a live tab vs real
  // `printToPDF` for this exact shape (an inline element with its own
  // explicit unitless `line-height` nested in a block whose OWN inherited
  // font-size differs) — not a fragmenter/page-context bug, and not fixable
  // in fragment.ts. It concentrates in code-heavy chapters (CLI/Markdown
  // Reference, Components), matching the growing per-chapter divergence.
  // Needs its own investigation (possibly: mount `predictPageMap` against
  // real print rendering instead of live-tab print-emulation) before this
  // can be un-allowlisted.
  { fixture: "design-guide", kind: "pageCount", reason: "residual ~11pp gap from a live-tab print-emulation vs real-printToPDF line-height quirk on `pre code` (see comment above) — NOT the named-page-context bug, which is fixed" },
  { fixture: "design-guide", kind: "pageMap", reason: "downstream of the pageCount divergence above — ids after code-heavy chapters land on a viewer page shifted by the accumulated line-height quirk" },
  { fixture: "design-guide", kind: "targetCounter", reason: "downstream of the pageMap divergence above — target-counter() resolves through the same (wrong) viewer page map" },
];

function isKnown(d: Divergence) {
  return KNOWN_DIVERGENCES.find((k) => k.fixture === d.fixture && k.kind === d.kind);
}

// ---------------------------------------------------------------------------
// stage a project dir into a self-contained book.html — the exact call
// build-runner.ts's renderBook() makes (resolveConfig -> loadPluginsWithCss
// -> renderChaptersToFile -> planImageCopies -> copy), forced to
// `engine: "native"` regardless of the project's own manifest so every
// fixture is staged as a real native-engine book would be.
// ---------------------------------------------------------------------------
async function stage(projectDir: string, outDir: string): Promise<string> {
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
  return htmlPath;
}

/**
 * Independent second measurement for a Tier 1/2 book, where `build()` never
 * ran `predictPageMap` (nothing needed instrumenting). Mounts the viewer on
 * its OWN page, pinned to the same deterministic viewport `build()` itself
 * measured against (`BuildResult.viewport`) — an unpinned viewport would
 * make a page-count mismatch meaningless (see `build.ts`'s "deterministic
 * viewport = the sheet" comment).
 */
async function viewerPageCount(
  browser: Browser,
  url: string,
  agentScript: string,
  viewerScript: string,
  viewport: { width: number; height: number },
): Promise<number> {
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
    await page.evaluate(`window.__FOLIO_MANUAL__ = true;`);
    await page.evaluate(viewerScript);
    return await page.evaluate<number>(
      `(async () => (await window.Gutterpress.fragmentDocument({})).totalPages)()`,
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
  const htmlPath = await stage(projectDir, stageDir);
  // allowShrink: true — this gate measures FRAGMENTER parity, not content
  // print-quality. A pre-existing width-overflow in a fixture book is a real
  // (separate) finding, not this gate's concern; downgrading it to a warning
  // (never rewriting the fixture's content) lets both fragmenters run so
  // their page maps can still be compared, exactly like the migration
  // spike's `--skip-pre-validate` on the same class of pre-existing issue.
  const result: BuildResult = await build({ input: htmlPath, browser, allowShrink: true });
  const divergences: Divergence[] = [];

  // ---- (a) total page count --------------------------------------------
  let viewerPages: number;
  if (result.predicted) {
    viewerPages = result.predicted.pageCount;
  } else {
    const url = pathToFileURL(htmlPath).href;
    viewerPages = await viewerPageCount(browser, url, agentScript, viewerScript, result.viewport);
  }
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
    divergences,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const requested = (args.length ? args : DEFAULT_FIXTURES).map((p) => resolve(p));
  // Two default fixtures live outside the repo (/tmp scratch books), so on a
  // fresh clone or in CI they are simply absent — skipping them keeps the
  // in-repo fixtures meaningful instead of failing the gate for a reason that
  // has nothing to do with parity. An explicitly named dir is never skipped.
  const fixtures = args.length
    ? requested
    : requested.filter((dir) => {
        if (existsSync(dir)) return true;
        console.log(`   SKIP ${dir} — not present on this machine`);
        return false;
      });
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
      const name = dir.replace(/\/+$/, "").split("/").pop()!;
      console.log(`\n== ${name} (${dir})`);
      try {
        const report = await runFixture(browser, name, dir, AGENT, VIEWER);
        reports.push(report);
        console.log(
          `   tier ${report.tier}, print ${report.printPages}pp / viewer ${report.viewerPages}pp, ` +
            `${report.instrumentedIds} instrumented id(s), ${report.divergences.length} divergence(s)`,
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

await main();
