/**
 * Pins `--gp-page-*` (#454) in both renderers: a look's rules that read the
 * page's own numbers resolve to the same geometry in the PDF and in the preview.
 *
 * `docs/fixtures/page-vars/book` sets asymmetric manifest margins (63pt inside,
 * 45pt outside) over a stylesheet `@page` margin of its own, and has
 *
 *  - a margin-box folio padded by `calc(var(--gp-page-margin-outside) - 2pt)`,
 *    so its text sits at the margin it starts from plus 43pt, on a recto
 *    (63pt) and on a verso (45pt) alike;
 *  - two plates on a zero-margin page, each `width: var(--gp-page-width)` and
 *    `height: calc(var(--gp-page-height) - 2pt)`, so each is one sheet.
 *
 * Without the numbers the viewer's plates collapse to one line (two of them
 * share a page), and a margin-box padding that does not resolve is 0. Measured
 * in the shipped PDF and in the built book's viewer, against one expected
 * number: the one the manifest says. The viewer half of the fixture's page
 * count is also held by the preview/print gate (docs/native-parity-gate.md).
 *
 * Self-skips when no Chromium is resolvable, like every real-browser test here.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serveDir } from "../engine/viewer/test-support/serve-dir.ts";
import { closeBrowser, getBrowser } from "../engine/viewer/test-support/browser.ts";
import { resolveChromiumExecutable } from "./chromium.ts";
import { runBuild } from "./build-runner.ts";
import { clearPdfCache } from "./pdf-inspect.ts";
import { extractReport } from "./render-parity.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../../docs/fixtures/page-vars/book");

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[render-parity.page-vars.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

const TIMEOUT_MS = 120_000;
const TOLERANCE_PT = 0.5;
const dirsToClean: string[] = [];

afterAll(async () => {
  clearPdfCache();
  await closeBrowser();
  for (const d of dirsToClean.splice(0)) await rm(d, { recursive: true, force: true });
});

// The manifest's numbers, in pt: 6 x 9in, margins 63 inside and 45 outside.
const SHEET_W = 432;
const INSIDE = 63;
const OUTSIDE = 45;
/** where the folio's text starts on a sheet: its margin box's left edge plus the padding */
const FOLIO_X = { recto: INSIDE + (OUTSIDE - 2), verso: OUTSIDE + (OUTSIDE - 2) };

async function build(format: "pdf" | "html") {
  const outDir = await mkdtemp(join(tmpdir(), `gp-page-vars-${format}-`));
  dirsToClean.push(outDir);
  const result = await runBuild({
    inputDir: FIXTURE,
    format,
    outDir,
    skipLint: true,
    skipPreValidate: true,
    skipPostValidate: true,
    rawArgs: {},
  });
  return { outDir, result };
}

describe("render-parity: --gp-page-* resolves the same in the preview and in print (#454)", () => {
  testIf(
    "print: the folio sits at its margin plus the outside margin less 2pt, and each plate is one sheet",
    async () => {
      const { result } = await build("pdf");
      const report = await extractReport(result.pdfPath!);
      // two prose pages, then one sheet for each plate
      expect(report.pageCount).toBe(4);
      const run = (page: number, text: string) => report.pages[page - 1]!.text.find((t) => t.s.startsWith(text))!;
      expect(run(1, "Folio").x).toBeCloseTo(FOLIO_X.recto, 0);
      expect(run(2, "Folio").x).toBeCloseTo(FOLIO_X.verso, 0);
      // a right-aligned plate ends where it does: --gp-page-width wide
      for (const [page, text] of [[3, "Plate one"], [4, "Plate two"]] as const) {
        const plate = run(page, text);
        expect(Math.abs(plate.x + plate.w - SHEET_W)).toBeLessThan(TOLERANCE_PT);
      }
    },
    TIMEOUT_MS,
  );

  testIf(
    "preview: the same folio positions, the same plates, the same pages",
    async () => {
      const { outDir } = await build("html");
      const { url, close } = await serveDir(outDir, "book.html");
      try {
        const page = await (await getBrowser()).newPage();
        try {
          await page.goto(`${url}book.html`);
          await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
          // a string, not a closure: this program has no DOM lib (tsconfig.json)
          const seen = await page.evaluate<{ pages: number; recto: number; verso: number; plates: number[] }>(`(() => {
            const PT = 0.75; // pt per CSS px
            const sheets = Array.from(document.querySelectorAll(".gp-sheet"));
            const folio = (n) => {
              const sheet = sheets[n - 1];
              const range = document.createRange();
              range.selectNodeContents(sheet.querySelector(".gp-marginbox-content"));
              return (range.getBoundingClientRect().left - sheet.getBoundingClientRect().left) * PT;
            };
            return {
              pages: window.Gutterpress.totalPages,
              recto: folio(1),
              verso: folio(2),
              plates: Array.from(document.querySelectorAll(".plate")).map((p) => p.getBoundingClientRect().width * PT),
            };
          })()`);
          expect(seen.pages).toBe(4);
          expect(Math.abs(seen.recto - FOLIO_X.recto)).toBeLessThan(TOLERANCE_PT);
          expect(Math.abs(seen.verso - FOLIO_X.verso)).toBeLessThan(TOLERANCE_PT);
          expect(seen.plates).toHaveLength(2);
          for (const w of seen.plates) expect(Math.abs(w - SHEET_W)).toBeLessThan(TOLERANCE_PT);
        } finally {
          await page.close();
        }
      } finally {
        await close();
      }
    },
    TIMEOUT_MS,
  );
});

