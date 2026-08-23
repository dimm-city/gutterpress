/**
 * Regression guard: the box after a forced break keeps its leading margin, as
 * print does.
 *
 * CSS Fragmentation truncates adjoining margins at an UNFORCED break and keeps
 * them at a FORCED one, and Chromium implements both — measured, in each
 * fragmenter: after a real `break-before: page` the following `h1` starts one
 * `margin-top` down from the page's content top; after a real
 * `break-before: column` in multicol it does the same.
 *
 * `synthesizeColumnBreaks()` used to force its break by inserting a spacer
 * sized to the space REMAINING in the column. That fills the column, so the
 * break it produces is an ORDINARY overflow break — and Chromium duly
 * truncated the following heading's `margin-top`, putting every chapter opener
 * flush against the top of the preview's page while the PDF indented it.
 * Measured on `examples/with-validation`: a `h1 { margin-top: 36pt }` lost 48px
 * on every chapter page, which is what let the preview fit content the PDF
 * pushed to a seventh page. The spacer now carries `break-after: column` and no
 * height, so the break is forced and the margin survives.
 */
import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a forced page break keeps the following box's margin-top, as print does",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".forced-margin-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "forced-break-margin.html"),
        path.join(dir, "forced-break-margin.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "forced-break-margin.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const opener = document.querySelector<HTMLElement>("#opener")!;
            const page = (window as any).Gutterpress.pageOf(opener);
            // The sheet is the printed page: `@page` margins are 0 here, so
            // its top edge IS the page's content top. Measuring against it
            // keeps the assertion independent of how the viewer happens to
            // arrange sheets on the stage (one long row, or wrapped rows).
            const sheet = document.querySelectorAll<HTMLElement>(".gp-sheet")[page]!;
            return {
              totalPages: (window as any).Gutterpress.totalPages,
              openerPage: page,
              openerTop:
                opener.getBoundingClientRect().top - sheet.getBoundingClientRect().top,
              marginTop: parseFloat(getComputedStyle(opener).marginTop),
            };
          });

          expect(result.totalPages).toBe(2);
          expect(result.openerPage).toBe(1);
          expect(result.marginTop).toBeCloseTo(48, 0);
          // Print starts the opener 48px below the content top. A truncated
          // margin would put it at 0.
          expect(result.openerTop).toBeCloseTo(48, 0);
        } finally {
          await page.close();
        }
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
