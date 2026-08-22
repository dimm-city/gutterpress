import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { resolveChromiumExecutable } from "../chromium.ts";
import { closeBrowser, getBrowser } from "../browser-pool.ts";
import { loadPdf, getTextPass } from "../pdf-inspect.ts";

/**
 * .gp-shape (shape-outside) behavior contract, measured in a real Chromium:
 *
 *   1. The shape actually takes effect — text wraps INTO a floated image's
 *      transparent region, so the shaped paragraph is measurably shorter
 *      than an identical control paragraph without the class.
 *   2. Print stays vector — the Paged.js-era warning in tools/README.md
 *      ("shape-outside: url() causes Chromium to rasterize entire pages")
 *      does NOT hold on the native path: the printed page's text must
 *      remain extractable and the PDF must stay small. If either assertion
 *      fails on a Chromium bump, shape has started rasterizing and that is
 *      a release blocker for this class.
 *
 * The fixture uses data: URIs for both src and --gp-shape, which is exactly
 * what the PRINT input contains after staging (inlineShapeUrls in
 * asset-inline.ts rewrites file references to data: URIs, because
 * shape-outside reads pixels and file:// origins block that — measured:
 * an identical file-path shape wraps over http:// and silently does
 * nothing over file://).
 */

const RENDER_TEST_TIMEOUT_MS = 60_000;

// 100x200; left half fully transparent, right half opaque — a shaped right
// float lets text extend ~50px further right than its rectangular box.
const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200" viewBox="0 0 100 200"><rect x="50" width="50" height="200" fill="#36c"/></svg>'
);
const SRC = `data:image/svg+xml,${SVG}`;

const WRAP_TEXT =
  "The marsh reveals itself twice a day and the tide table is a promise the water mostly keeps while wind rewrites it at the margins and the moon signs it twice a month before the mud files it away again under eelgrass. ".repeat(
    3
  );

const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 400px 600px; margin: 20px; }
body { font: 14px/1.4 serif; width: 360px; }
p { margin: 0 0 8px; }
</style>
<p id="ctrl"><img class="gp-right" src="${SRC}" alt="">${WRAP_TEXT}</p>
<p id="shaped"><img class="gp-right gp-shape" style='--gp-shape:url("${SRC}")' src="${SRC}" alt="">${WRAP_TEXT}</p>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[paged-css-image-shape.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "gp-shape wraps text into the alpha silhouette and print output stays vector text",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-imgshape-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

        // Evaluated as a source string, not a closure (DOM-free tsconfig).
        const m = (await page.evaluate(
          `(() => ({
            ctrl: document.getElementById("ctrl").getBoundingClientRect().height,
            shaped: document.getElementById("shaped").getBoundingClientRect().height,
          }))()`
        )) as { ctrl: number; shaped: number };

        // The shaped paragraph gains a wider text column beside the float's
        // transparent half, so it needs fewer lines: strictly shorter, by at
        // least one 1.4 * 14px line. (MEASURED here: 274.3px -> 254.7px.)
        expect(m.shaped).toBeLessThan(m.ctrl - 14);

        // Print: text on the shaped page stays extractable text, and the
        // whole PDF stays a few KB — a rasterized page would be neither.
        const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        expect(bytes.length).toBeLessThan(100_000);
        const pdfPath = path.join(dir, "shape.pdf");
        await fsp.writeFile(pdfPath, bytes);
        const doc = await loadPdf(pdfPath);
        expect(doc).not.toBeNull();
        const { textByPage } = await getTextPass(doc!);
        expect(textByPage.join(" ")).toContain("tide table is a promise");
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
