import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PAGED_CSS } from "./markdown-it-paged.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { resolveChromiumExecutable } from "../chromium.ts";
import { closeBrowser, getBrowser } from "../browser-pool.ts";
import { inspectPdf } from "../../engine/shared/pdf-inspect.ts";

/**
 * Regression: a lone image sized to exactly the page content box must not
 * make its paragraph taller than that box.
 *
 * An `<img>` inside a `<p>` is inline-level, so its line box adds
 * half-leading/descender space UNDER the image. A book that caps art at
 * `page-height - margins` (or art that naturally fills the sheet) therefore
 * produced a paragraph a few px TALLER than the box it was sized to fit. The
 * overflow pushed the enclosing named-page wrapper's bottom edge onto the NEXT
 * sheet — and a sheet whose first box is the PREVIOUS page's trailing fragment
 * takes the PREVIOUS page's name, so the next template's `@page` rules (running
 * head, folio, page size) silently did not apply to it.
 *
 * Observed on the field guide (34pp, native engine, Chromium 148/151): a 956px
 * image on a 960px content box made a 963.59px paragraph, and page 7 — the
 * first `citizen-file` page — printed with no running head and no folio, while
 * the Paged.js leg printed both. `vertical-align: bottom` in PAGED_CSS
 * collapses the line box onto the image and fixes it.
 *
 * The fixture below is that bug with nothing else in it: no plugin, no book
 * CSS, no images from disk. It asserts BOTH halves —
 *   (1) the geometry (paragraph height == image height), and
 *   (2) the printed consequence, read from the PDF itself: the two named pages
 *       are given DIFFERENT `size`s, so the second sheet's MediaBox proves
 *       which `@page` name Chromium actually applied to it.
 * Reverting the CSS fix fails (2) with a second sheet 360pt tall (page `a`'s
 * size) instead of 224.88pt (page `b`'s).
 */

const RENDER_TEST_TIMEOUT_MS = 60_000;

/** Page `a`: 384x480px sheet, 24px margins -> a 432px-tall content box. */
const IMG_PX = 432;
const PAGE_A_HEIGHT_PT = 360; // 480px
const PAGE_B_HEIGHT_PT = 224.88; // 300px, minus Chromium's own rounding

const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect width="100" height="200" fill="#c33"/></svg>'
);

const fixture = `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; }
${PAGED_CSS}
${GUTTERPRESS_CSS}
@page a { size: 384px 480px; margin: 24px; }
@page b { size: 384px 300px; margin: 24px; }
.page.a { page: a; }
.page.b { page: b; }
#art { height: ${IMG_PX}px; }
p { margin: 0; }
</style>
<div class="page a"><p><img id="art" src="data:image/svg+xml,${SVG}" alt="art"></p></div>
<div class="page b"><p>SECOND</p></div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[paged-css-image-fit.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a lone image sized to the content box does not overflow it, so the next named page keeps its own @page rules",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-imgfit-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

        // Evaluated as a source string, not a closure: this package's tsconfig
        // is deliberately DOM-free (see its comment), so `document` has no type
        // here.
        const measured = (await page.evaluate(
          `(() => {
            const par = document.querySelector(".page.a p");
            const img = document.getElementById("art");
            return {
              paragraph: par.getBoundingClientRect().height,
              image: img.getBoundingClientRect().height,
            };
          })()`
        )) as { paragraph: number; image: number };
        expect(measured.image).toBe(IMG_PX);
        expect(measured.paragraph).toBe(IMG_PX);

        const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const facts = await inspectPdf(new Uint8Array(bytes));
        expect(facts.pageCount).toBe(2);
        const heights = facts.boxes.map((b) => b.media[3]);
        expect(heights[0]).toBeCloseTo(PAGE_A_HEIGHT_PT, 1);
        // The load-bearing assertion: sheet 2 is sized by `@page b`, which only
        // happens if Chromium named it `b` — i.e. page `a` ended on sheet 1.
        expect(heights[1]).toBeCloseTo(PAGE_B_HEIGHT_PT, 1);
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
