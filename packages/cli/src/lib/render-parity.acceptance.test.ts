/**
 * Chromium-backed acceptance test for the render-parity gate (issue #252).
 *
 * Two things this suite proves that render-parity.test.ts's synthetic-report
 * tests cannot, because they never touch a real PDF:
 *
 *   1. The gate's actual acceptance criterion — "the gate reproduces a
 *      known-good build twice with a byte-identical report." Two independent
 *      `runBuild()` calls over the SAME fixture, same Chromium, must extract
 *      to byte-identical serialized reports.
 *   2. A real regression is actually caught: rebuilding the same fixture with
 *      a one-point CSS shift injected must fail `compareReports` with a
 *      `text` diff naming the affected page.
 *
 * Self-skips (like every other real-Chromium test in this package — see
 * chromium.ts's `resolveChromiumExecutable`) when no Chrome/Chromium/Edge is
 * resolvable. Running it needs the env vars documented in this repo's
 * AGENT-ENV.md-equivalent (PUPPETEER_EXECUTABLE_PATH / GUTTERPRESS_CHROMIUM_ARGS
 * under a root/no-sandbox container); CI supplies PUPPETEER_EXECUTABLE_PATH via
 * the runner's own Chrome.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "./chromium.ts";
import { runBuild } from "./build-runner.ts";
import { closeBrowser } from "./browser-pool.ts";
import { clearPdfCache } from "./pdf-inspect.ts";
import { compareReports, extractReport, serializeReport } from "./render-parity.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// docs/fixtures/gp-image-positioning/book: a small (few-page) committed
// fixture that exercises BOTH text and images (flow floats + @page pins) —
// see native-parity-gate.ts's own use of this fixture family. Reused here
// rather than inventing a new one, per the issue's own suggestion.
const FIXTURE = join(HERE, "../../../../docs/fixtures/gp-image-positioning/book");

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[render-parity.acceptance.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH/PUPPETEER_EXECUTABLE_PATH to run it.",
  );
}

const TIMEOUT_MS = 90_000;
const dirsToClean: string[] = [];

afterAll(async () => {
  // Every build below passes keepBrowserAlive so concurrent builds share one
  // pooled Chromium instead of racing each other's close() (browser-pool.ts's
  // pool is a single shared instance; runBuild's default is to close it in a
  // `finally`, which would kill a sibling build's in-flight page). This suite
  // owns the one shutdown instead.
  if (chromium) await closeBrowser();
  clearPdfCache();
  for (const d of dirsToClean.splice(0)) await rm(d, { recursive: true, force: true });
});

async function buildFixturePdf(projectDir: string, tag: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), `gp-render-parity-${tag}-`));
  dirsToClean.push(outDir);
  const result = await runBuild({
    inputDir: projectDir,
    format: "pdf",
    outDir,
    // This suite is about render-parity extraction, not CSS lint/pre-build
    // validation — same reasoning as the other real-Chromium `runBuild(pdf)`
    // tests in this package (see build-runner.page-background.test.ts).
    skipLint: true,
    skipPreValidate: true,
    keepBrowserAlive: true,
    rawArgs: {},
  });
  if (!result.pdfPath) throw new Error(`build of ${projectDir} produced no pdfPath`);
  return result.pdfPath;
}

describe("render-parity acceptance", () => {
  testIf(
    "the gate reproduces a known-good build twice with a byte-identical report",
    async () => {
      expect(existsSync(FIXTURE)).toBe(true);

      const [pdfA, pdfB] = await Promise.all([
        buildFixturePdf(FIXTURE, "a"),
        buildFixturePdf(FIXTURE, "b"),
      ]);
      const [reportA, reportB] = await Promise.all([extractReport(pdfA), extractReport(pdfB)]);

      // Not a vacuous pass on two empty documents — the fixture actually
      // exercises both text and image extraction.
      expect(reportA.pageCount).toBeGreaterThan(0);
      expect(reportA.pages.some((p) => p.text.length > 0)).toBe(true);
      expect(reportA.pages.some((p) => p.images.length > 0)).toBe(true);

      expect(serializeReport(reportA)).toBe(serializeReport(reportB));

      const result = compareReports(reportA, reportB);
      expect(result.diffs).toEqual([]);
    },
    TIMEOUT_MS,
  );

  testIf(
    "a deliberate one-point CSS shift fails the gate with a text diff naming the page",
    async () => {
      // Copy the fixture so the injected shift never touches the committed
      // one, then add exactly the kind of change a real regression looks
      // like: one point of extra top padding. Fragmentation `padding` (CSS
      // Fragmentation §profile: box-decoration-break defaults to `slice`)
      // applies only at the FIRST fragment of a box, so this shifts page 1's
      // content down by 1pt and leaves every later page's pagination alone —
      // a clean, localized reproduction rather than a whole-book reflow.
      const shiftedDir = await mkdtemp(join(tmpdir(), "gp-render-parity-shifted-"));
      dirsToClean.push(shiftedDir);
      await cp(FIXTURE, shiftedDir, { recursive: true });
      const cssPath = join(shiftedDir, "styles", "style.css");
      const css = await readFile(cssPath, "utf8");
      await writeFile(cssPath, `${css}\nbody { padding-top: 1pt; }\n`, "utf8");

      const [basePdf, shiftedPdf] = await Promise.all([
        buildFixturePdf(FIXTURE, "base"),
        buildFixturePdf(shiftedDir, "shifted"),
      ]);
      const [base, cand] = await Promise.all([extractReport(basePdf), extractReport(shiftedPdf)]);

      const result = compareReports(base, cand);
      expect(result.diffs.length).toBeGreaterThan(0);

      const textDiffOnPage1 = result.diffs.find((d) => d.kind === "text" && d.page === 1);
      expect(textDiffOnPage1).toBeDefined();
    },
    TIMEOUT_MS,
  );
});
