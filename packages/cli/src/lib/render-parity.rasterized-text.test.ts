/**
 * Pins the render-parity blind spot investigated in issue #259: some styled
 * component prose does not appear in the extracted text runs AT ALL, so a
 * text-only change confined to it compares as identical.
 *
 * Investigation finding (see docs/render-parity-gate.md's "Known blind spot"
 * section for the full writeup): this is NOT a bug in `getTextPass`'s
 * `it.transform && it.str.trim().length > 0` filter, and the text is not
 * merely hard for pdf.js to find (no marked-content/Type3 quirk). `filter`
 * (measured and documented in docs/engine/ENGINE.md #10 — confirmed again
 * here on a fresh fixture) makes Chromium rasterize the WHOLE filtered
 * subtree to an embedded bitmap image before it ever reaches a PDF content
 * stream. `page.getTextContent()` returns zero items for that region — there
 * is no text for ANY extractor, pdf.js-based or otherwise, to find. The
 * private book's `.dc-specialty-intro` and `.section.tabbed` hit this because
 * both give a non-rectangular (`clip-path`) card a shadow that must follow
 * that silhouette, which needs `filter: drop-shadow` rather than the vector
 * `box-shadow` the rest of `.section` chrome uses (ENGINE.md #10's own
 * stated reason `filter` is ever still needed).
 *
 * `clip-path` alone does NOT reproduce this (confirmed below and during the
 * investigation, also true of `backdrop-filter` and `mix-blend-mode` alone,
 * on Chromium 152) — the blind spot is specific to `filter`, not to "any
 * styled/shaped component", which is why `.only-clip-path` is asserted
 * present rather than omitted from the fixture.
 *
 * Self-skips (like every other real-Chromium test in this package — see
 * chromium.ts's `resolveChromiumExecutable`) when no Chrome/Chromium/Edge is
 * resolvable.
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
import { compareReports, extractReport, type Report } from "./render-parity.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// docs/fixtures/rasterized-text/book: a public, minimal reproduction of the
// private book's `.dc-specialty-intro` / `.section.tabbed` construct (a
// clip-path silhouette with a shape-following filter: drop-shadow), built
// for this issue since the real classes are not public.
const FIXTURE = join(HERE, "../../../../docs/fixtures/rasterized-text/book");

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[render-parity.rasterized-text.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH/PUPPETEER_EXECUTABLE_PATH to run it.",
  );
}

const TIMEOUT_MS = 90_000;
const dirsToClean: string[] = [];

afterAll(async () => {
  if (chromium) await closeBrowser();
  clearPdfCache();
  for (const d of dirsToClean.splice(0)) await rm(d, { recursive: true, force: true });
});

async function buildFixturePdf(projectDir: string, tag: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), `gp-rasterized-text-${tag}-`));
  dirsToClean.push(outDir);
  const result = await runBuild({
    inputDir: projectDir,
    format: "pdf",
    outDir,
    // Same reasoning as render-parity.acceptance.test.ts: this suite is
    // about extraction, not CSS lint/pre-build validation — and the fixture
    // deliberately uses `filter`/`clip-path`, which printsafe flags on
    // purpose (see printsafe.test.ts's own filter-warning coverage).
    skipLint: true,
    skipPreValidate: true,
    skipPostValidate: true,
    keepBrowserAlive: true,
    rawArgs: {},
  });
  if (!result.pdfPath) throw new Error(`build of ${projectDir} produced no pdfPath`);
  return result.pdfPath;
}

/**
 * Copies FIXTURE to a scratch dir, applies same-length word swaps to
 * content.md (so line-wrapping — and hence any filtered box's rendered
 * height — cannot shift as a side effect), and builds it.
 */
async function buildEditedVariant(tag: string, swaps: Array<[string, string]>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `gp-rasterized-text-src-${tag}-`));
  dirsToClean.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  const contentPath = join(dir, "content.md");
  let content = await readFile(contentPath, "utf8");
  for (const [from, to] of swaps) {
    if (from.length !== to.length) {
      throw new Error(`sentinel swap must preserve length: "${from}" vs "${to}"`);
    }
    if (!content.includes(from)) {
      throw new Error(`fixture content.md no longer contains sentinel "${from}"`);
    }
    content = content.replace(from, to);
  }
  await writeFile(contentPath, content, "utf8");
  return buildFixturePdf(dir, tag);
}

function allText(report: Report): string {
  return report.pages.flatMap((p) => p.text.map((t) => t.s)).join(" | ");
}

describe("render-parity: filtered-subtree text is a documented blind spot (#259)", () => {
  testIf(
    "baseline: unfiltered sentinels extract; filter+clip-path sentinels do not",
    async () => {
      expect(existsSync(FIXTURE)).toBe(true);
      const pdf = await buildFixturePdf(FIXTURE, "baseline");
      const report = await extractReport(pdf);

      expect(report.pageCount).toBe(1);
      const text = allText(report);

      // Plain text and clip-path-only text are real PDF text — the gate
      // sees them fine.
      expect(text).toContain("ALPHA sentinel text");
      expect(text).toContain("BRAVO sentinel text");

      // filter (+ clip-path, to follow the card's silhouette) rasterizes the
      // whole subtree: this text is not merely filtered out downstream, it
      // was never emitted as PDF text at all.
      expect(text).not.toContain("DELTA sentinel text");
      expect(text).not.toContain("INDIA sentinel text");

      // In its place: one embedded raster image per filtered section —
      // confirms *what* replaced the text, not just that it is absent.
      expect(report.pages[0]!.images.length).toBe(2);
    },
    TIMEOUT_MS,
  );

  testIf(
    "a text-only change INSIDE the filtered sections compares as fully clean — the reported symptom",
    async () => {
      const [basePdf, editedPdf] = await Promise.all([
        buildFixturePdf(FIXTURE, "base-for-blindspot"),
        buildEditedVariant("blindspot", [
          ["DELTA", "HOTEL"],
          ["INDIA", "JEWEL"],
        ]),
      ]);
      const [base, edited] = await Promise.all([extractReport(basePdf), extractReport(editedPdf)]);

      // Sanity: the edited PDF really does contain different sentinel prose
      // — this is not a no-op build, and the new word is still absent too
      // (it isn't that DELTA specifically is special-cased somewhere).
      const editedText = allText(edited);
      expect(editedText).not.toContain("DELTA sentinel text");
      expect(editedText).not.toContain("HOTEL sentinel text");
      expect(editedText).not.toContain("INDIA sentinel text");
      expect(editedText).not.toContain("JEWEL sentinel text");

      const result = compareReports(base, edited);
      expect(result.diffs).toEqual([]);
    },
    TIMEOUT_MS,
  );

  testIf(
    "contrast: the SAME kind of edit outside a filtered section IS caught — the gate is not broken generally",
    async () => {
      const [basePdf, editedPdf] = await Promise.all([
        buildFixturePdf(FIXTURE, "base-for-contrast"),
        buildEditedVariant("contrast", [["ALPHA", "OMEGA"]]),
      ]);
      const [base, edited] = await Promise.all([extractReport(basePdf), extractReport(editedPdf)]);

      const result = compareReports(base, edited);
      expect(result.diffs.length).toBeGreaterThan(0);
      expect(result.diffs.some((d) => d.kind === "text" && d.page === 1)).toBe(true);
    },
    TIMEOUT_MS,
  );
});
