/**
 * Regression guard: a scroll container must fragment on screen exactly as it
 * fragments in print.
 *
 * `pre code { overflow-x: auto }` is the ordinary markdown-CSS code-block
 * idiom (`overflow-x: auto` computes `overflow-y` to `auto`, so the box is a
 * scroll container). Chromium's PRINT fragmenter expands a scroll container to
 * its full scrollable size and slices it across pages — measured, on a 300px
 * page with 192px already used: B1..B4 print on page 1 and B5..B8 on page 2.
 * Chromium's MULTICOL fragmenter, which is what the viewer paginates with,
 * treats the same box as MONOLITHIC: it refuses to slice it and moves the
 * whole block to the next column, leaving the rest of the page empty.
 *
 * That is a preview↔print divergence at every code block that straddles a page
 * boundary, and it is what put `examples/with-validation`'s "Filtering" heading
 * on preview page 2 against the PDF's page 1. `expandScrollContainers()` maps
 * the computed `auto`/`scroll` overflow of a strip descendant to `clip` —
 * still clipped, no longer a scroll container, and so fragmentable again.
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
  "a scroll container splits across pages instead of being moved whole",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".scroll-frag-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "scroll-container-fragment.html"),
        path.join(dir, "scroll-container-fragment.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "scroll-container-fragment.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const pre = document.querySelector<HTMLElement>("#code")!;
            const code = pre.querySelector<HTMLElement>("code")!;
            const strip = pre.closest<HTMLElement>(".gp-strip")!;
            const sr = strip.getBoundingClientRect();
            return {
              totalPages: (window as any).Gutterpress.totalPages,
              preFragments: pre.getClientRects().length,
              // The first fragment must START in the page the padding block
              // left room in, i.e. at the padding's bottom, not at a fresh
              // column's top.
              firstFragmentTop: pre.getClientRects()[0]!.top - sr.top,
              codeOverflowX: getComputedStyle(code).overflowX,
              codeOverflowY: getComputedStyle(code).overflowY,
            };
          });

          // Print puts B1..B4 on page 1 and B5..B8 on page 2: two pages, and
          // the block is sliced. The monolithic multicol behaviour gives two
          // pages as well, but with the block moved WHOLE — so the fragment
          // count and the first fragment's position are what pin it.
          expect(result.totalPages).toBe(2);
          expect(result.preFragments).toBe(2);
          expect(result.firstFragmentTop).toBeCloseTo(192, 0);
          // Still clipped — `clip` is not a scroll container, so it fragments,
          // but the author's overflow is not silently turned into `visible`.
          expect(result.codeOverflowX).toBe("clip");
          expect(result.codeOverflowY).toBe("clip");
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
