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

/**
 * A scroll container must fragment in the viewer, because it fragments in
 * print and the preview has to agree with the PDF.
 *
 * This asserts BOTH halves of `splitScrollContainers`:
 *
 *  - the shim works — `#clipped` (inside a strip) splits across the page
 *    boundary the way print splits it, and keeps the block formatting context
 *    `overflow: hidden` gave it;
 *  - the shim is still NEEDED — `#control` is the identical box in a plain
 *    multicol container outside any strip, where the shim never reaches. It
 *    records raw Chromium behaviour. When Chromium starts fragmenting scroll
 *    containers in multicol, that assertion fails, and the fix is to DELETE
 *    the shim rather than to update the number.
 */
testIf(
  "a scroll container fragments in the viewer, matching print",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".scroll-split-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "scroll-container-split.html"),
        path.join(dir, "scroll-container-split.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "scroll-container-split.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const r = await page.evaluate(() => {
            const clipped = document.querySelector<HTMLElement>("#clipped")!;
            const control = document.querySelector<HTMLElement>("#control")!;
            const gp = (window as any).Gutterpress;
            const cs = getComputedStyle(clipped);
            return {
              fragments: clipped.getClientRects().length,
              startsOnPage: gp.pageOf(clipped),
              pageRange: gp.pageRangeOf(clipped),
              marked: clipped.dataset.gpFragmentable,
              overflowX: cs.overflowX,
              overflowY: cs.overflowY,
              // `clip` alone would drop the BFC that `hidden` established;
              // `flow-root` is what keeps it.
              display: cs.display,
              controlFragments: control.getClientRects().length,
              controlOverflow: getComputedStyle(control).overflowY,
              controlMarked: control.dataset.gpFragmentable,
            };
          });

          // The shim fired, and turned the scroll container into an
          // equivalent box that is not one.
          expect(r.marked).toBe("");
          expect(r.overflowX).toBe("clip");
          expect(r.overflowY).toBe("clip");
          expect(r.display).toBe("flow-root");

          // 300px of filler + a 200px block in a 400px content box: it fits
          // only by splitting, which is what print does with it.
          expect(r.fragments).toBe(2);
          expect(r.startsOnPage).toBe(0);
          expect(r.pageRange).toEqual([0, 1]);

          // The control is untouched by the shim and still monolithic — the
          // Chromium divergence this shim exists for. If this starts passing
          // as 2, delete `splitScrollContainers` and this test.
          expect(r.controlMarked).toBeUndefined();
          expect(r.controlOverflow).toBe("hidden");
          expect(r.controlFragments).toBe(1);
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
