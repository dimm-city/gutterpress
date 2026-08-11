import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { resolveChromiumExecutable } from "../chromium.ts";
import { closeBrowser, getBrowser } from "../browser-pool.ts";

/**
 * Regression: `.gp-bleed` must reach the paper edge on a book that has NOT
 * written its own `body { margin: 0 }`.
 *
 * `.gp-bleed` gets edge-to-edge under the native engine by sitting on
 * `@page gp-full-bleed`, whose side margins are zero — so the PAGE content
 * box is the sheet. But `width: 100%` resolves against the element's
 * containing block, which is the BODY, and the UA default `body { margin:
 * 8px }` survives native print (Paged.js's polisher drops it, which is why
 * only the native leg was affected). The art therefore stopped 8px short of
 * each edge unless the book happened to reset the body itself.
 *
 * MEASURED before the fix, 300dpi raster of a real `gutterpress build
 * --engine native` on a 6x4in sheet with 0.75in margins and no author body
 * rule: ink on the bleed page spanned 0.080..5.917in instead of
 * 0.000..6.000in — a visible white frame. Adding `body { margin: 0 }` to
 * MARKER_CSS took the same build to exactly 0.000..6.000in, and left the
 * Paged.js leg byte-for-byte where it already was.
 *
 * This test asserts the layout cause rather than re-rastering a PDF: with
 * MARKER_CSS applied and no author reset, a `.gp-bleed` block must span the
 * full width of its containing block's own containing block (here the
 * viewport, standing in for the zero-margin page box) with no inset on
 * either side. Deleting the `body` rule from MARKER_CSS fails this with
 * left = 8 and right = width - 8.
 */

const RENDER_TEST_TIMEOUT_MS = 60_000;
const VIEWPORT_W = 600;

const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" fill="#c33"/></svg>'
);

// Deliberately NO `body { margin: 0 }` here — that is the whole point.
const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 600px 400px; margin: 40px; }
</style>
<p>text</p>
<img class="gp-bleed" src="data:image/svg+xml,${SVG}" alt="art">`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[paged-css-full-bleed.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  ".gp-bleed spans edge to edge on a book with no body-margin reset of its own",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-fullbleed-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: VIEWPORT_W, height: 400 });
        await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

        // Source string, not a closure: this package's tsconfig is DOM-free.
        const measured = (await page.evaluate(
          `(() => {
            const r = document.querySelector(".gp-bleed").getBoundingClientRect();
            const cs = getComputedStyle(document.body);
            return {
              left: r.left,
              right: r.right,
              bodyMarginLeft: cs.marginLeft,
              bodyMarginRight: cs.marginRight,
            };
          })()`
        )) as { left: number; right: number; bodyMarginLeft: string; bodyMarginRight: string };

        expect(measured.bodyMarginLeft).toBe("0px");
        expect(measured.bodyMarginRight).toBe("0px");
        expect(measured.left).toBe(0);
        expect(measured.right).toBe(VIEWPORT_W);
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
