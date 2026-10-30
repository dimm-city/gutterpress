/**
 * #454 — where `@page` margins print, read off the built PDF.
 *
 * A look's and core's `@page` rules are written after their cascade layers,
 * unlayered, so Chromium ranks them by page selector and then order, as the
 * engine's own `@page` reader always has. Each fixture under docs/fixtures
 * pins one row of that cascade, and the preview/print parity gate holds the
 * preview to the same pages:
 *
 *   - named-page-margins: a look's `@page full { margin: 0 }` keeps its zero
 *     margin under the manifest's `page.margin`, which still sets the other
 *     pages. While the rule sat in the look's layer, the plate printed inset
 *     by the book's margins and ran onto a second page;
 *   - book-page-margin: the book's own unnamed `@page` margin beats the
 *     look's and core's 1in default, and loses to `page.margin`;
 *   - two-looks: the later look's margin wins, and both beat the default;
 *   - core-full-bleed: core's `@page full-bleed` page and a `.gp-bleed` image
 *     keep their zero margins under `page.margin`. While core's `@page` rules
 *     sat in core's layers, the page printed inset and ran onto a second
 *     sheet and the image stopped at the margins.
 *
 * A text run's x is where its line starts: the page's left margin, plus the
 * padding of a plate or a full-bleed block. Self-skips when no Chromium is resolvable,
 * like every real-Chromium test in this package.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "./chromium.ts";
import { runBuild } from "./build-runner.ts";
import { loadManifestWithPath, resolveConfig } from "./manifest.ts";
import { renderChapters } from "./markdown/index.ts";
import { clearPdfCache } from "./pdf-inspect.ts";
import { extractReport, type PageReport, type Report } from "./render-parity.ts";
import { extract, resolvePage } from "../engine/shared/gcpm-extract.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/fixtures");

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[render-parity.page-margins.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

const TIMEOUT_MS = 90_000;
const dirsToClean: string[] = [];

afterAll(async () => {
  clearPdfCache();
  for (const d of dirsToClean.splice(0)) await rm(d, { recursive: true, force: true });
});

async function buildReport(projectDir: string): Promise<Report> {
  const outDir = await mkdtemp(join(tmpdir(), "gp-page-margins-"));
  dirsToClean.push(outDir);
  const result = await runBuild({
    inputDir: projectDir,
    format: "pdf",
    outDir,
    skipLint: true,
    skipPreValidate: true,
    skipPostValidate: true,
    rawArgs: {},
  });
  if (!result.pdfPath) throw new Error(`build of ${projectDir} produced no pdfPath`);
  return extractReport(result.pdfPath);
}

/** Where the page's text starts on the left, in points from the sheet edge. */
function leftEdge(page: PageReport): number {
  return Math.min(...page.text.map((t) => t.x));
}

/** The page carrying a text run that contains `s`, 1-based. */
function pageWith(report: Report, s: string): number {
  return report.pages.findIndex((p) => p.text.some((t) => t.s.includes(s))) + 1;
}

describe("@page margins in print (#454)", () => {
  testIf(
    "a look's named page keeps its zero margin under the manifest's margins; the other pages keep the manifest's",
    async () => {
      const report = await buildReport(join(FIXTURES, "named-page-margins", "book"));
      // One page for the plate. Inset by the margins, it ran onto a second.
      expect(report.pageCount).toBe(3);
      expect(pageWith(report, "The Plate")).toBe(2);
      // The plate's text sits at its 0.5in padding from the sheet edge, not
      // 54pt (the verso's outside margin) further in.
      expect(leftEdge(report.pages[1]!)).toBeCloseTo(36, 0);
      // Right-hand pages: the manifest's inside margin, not the look's 0.25in.
      expect(leftEdge(report.pages[0]!)).toBeCloseTo(72, 0);
      expect(leftEdge(report.pages[2]!)).toBeCloseTo(72, 0);
    },
    TIMEOUT_MS,
  );

  testIf(
    "the book's own @page margin beats the look's and the 1in default, and loses to the manifest's",
    async () => {
      const fixture = join(FIXTURES, "book-page-margin", "book");
      const own = await buildReport(fixture);
      expect(own.pageCount).toBeGreaterThan(1);
      for (const page of own.pages) expect(leftEdge(page)).toBeCloseTo(54, 0);

      const dir = await mkdtemp(join(tmpdir(), "gp-page-margins-src-"));
      dirsToClean.push(dir);
      await cp(fixture, dir, { recursive: true });
      // The manifest ends in its `page:` block.
      await appendFile(join(dir, "manifest.yaml"), "  margin: { top: 63, bottom: 63, inside: 63, outside: 63 }\n");
      const manifest = await buildReport(dir);
      for (const page of manifest.pages) expect(leftEdge(page)).toBeCloseTo(63, 0);
    },
    TIMEOUT_MS * 2,
  );

  testIf(
    "core's full-bleed page and a .gp-bleed image keep their zero margins under the manifest's, in print as in the preview",
    async () => {
      const fixture = join(FIXTURES, "core-full-bleed", "book");
      // The preview's margins: the engine's `@page` reader on the book's CSS.
      const { manifest } = await loadManifestWithPath(fixture);
      const config = resolveConfig({}, manifest);
      const html = await renderChapters(fixture, {
        styles: config.styles,
        files: config.chapters,
        printArea: { ...config.page, preset: config.preset, spec: config.spec },
      });
      const model = extract(html.slice(html.indexOf("<style data-project-css>"), html.indexOf("</style>")));
      const fullBleed = resolvePage(model, { name: "gp-page-full-bleed", pseudos: ["left"] }).geometry.margin;
      const bleed = resolvePage(model, { name: "gp-full-bleed", pseudos: ["right"] }).geometry.margin;
      expect(fullBleed).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
      expect([bleed.left, bleed.right]).toEqual([0, 0]);

      const report = await buildReport(fixture);
      // The full-bleed page fits on one sheet. Inset by the margins, it ran onto a second.
      expect(report.pageCount).toBe(5);
      // Its text sits at its 0.25in padding from the sheet edge, on a verso
      // whose outside margin is 54pt.
      const sheet = pageWith(report, "Full-bleed text");
      expect(sheet).toBe(2);
      expect(leftEdge(report.pages[sheet - 1]!)).toBeCloseTo(fullBleed.left + 18, 0);
      // The bleed image, on a recto whose inside margin is 72pt, spans the sheet.
      const image = report.pages[3]!.images[0]!;
      expect(image.x).toBeCloseTo(bleed.left, 0);
      expect(image.w).toBeCloseTo(432 - bleed.left - bleed.right, 0);
      // The pages around them keep the manifest's: recto, inside margin 72pt.
      expect(leftEdge(report.pages[0]!)).toBeCloseTo(72, 0);
      expect(leftEdge(report.pages[4]!)).toBeCloseTo(72, 0);
    },
    TIMEOUT_MS,
  );

  testIf(
    "of two looks the later look's margin wins, and both beat the 1in default",
    async () => {
      const report = await buildReport(join(FIXTURES, "two-looks", "book"));
      expect(report.pageCount).toBeGreaterThan(1);
      for (const page of report.pages) expect(leftEdge(page)).toBeCloseTo(54, 0);
    },
    TIMEOUT_MS,
  );
});
