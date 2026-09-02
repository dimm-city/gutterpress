import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKER_CSS } from "./markers.js";
import { resolveChromiumExecutable } from "../chromium.ts";
import { closeBrowser, getBrowser } from "../browser-pool.ts";

/**
 * #231 (2026-09-01 CSS architecture review, finding C8): two engine-generic
 * print fixes adopted into MARKER_CSS from a real book's own engine sheet —
 * see the doc comment above `export const MARKER_CSS` in markers.js for the
 * full rationale and the field-guide measurements (chapter-01's placard,
 * chapter-03's full-sheet plate, 295pp total, all unchanged by adoption).
 *
 * A bare (unclassed) markdown placard taller than the page content box is
 * monolithic replaced content, and the fragmenter SLICES it mid-image across
 * a page break instead of moving it whole. Capping it to `--gp-content-h`
 * (core's own published page CONTENT height) with `object-fit: contain`
 * letterboxes it onto one page. Scoped to `:not([class])` so an explicitly
 * classed image (`.gp-full`, `.gp-bleed`, an author's own sizing) is
 * untouched — this is a safety net for the images nobody sized, not a
 * universal cap.
 */

describe("MARKER_CSS — #231 adopted print fixes", () => {
  test("caps a bare image to the published page content height, and gives figure keep-together", () => {
    expect(MARKER_CSS).toContain(
      ":where(p) > :where(img:not([class])) { max-height: calc(var(--gp-content-h) - 4px); object-fit: contain; }"
    );
    expect(MARKER_CSS).toContain(":where(figure) { break-inside: avoid; }");
  });
});

const RENDER_TEST_TIMEOUT_MS = 60_000;

const CONTENT_H_PX = 300;
// Tall enough that, uncapped, it would exceed the published content height
// several times over — any residual cap-related rounding is noise next to
// this gap.
const TALL_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 900"><rect width="200" height="900" fill="#c33"/></svg>'
);

const fixture = `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; }
${MARKER_CSS}
:root { --gp-content-h: ${CONTENT_H_PX}px; }
p { margin: 0; }
figure { margin: 0; }
</style>
<p><img id="bare" src="data:image/svg+xml,${TALL_SVG}" alt="bare"></p>
<p><img id="classed" class="gp-full" src="data:image/svg+xml,${TALL_SVG}" alt="classed"></p>
<figure id="fig"><img src="data:image/svg+xml,${TALL_SVG}" alt="figured"></figure>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[marker-css-image-cap.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a bare image is capped and letterboxed; a classed image of the same art is not",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-imgcap-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

        // Source string, not a closure: this package's tsconfig is DOM-free.
        const measured = (await page.evaluate(
          `(() => {
            const bare = document.getElementById("bare");
            const classed = document.getElementById("classed");
            const fig = document.getElementById("fig");
            return {
              bareHeight: bare.getBoundingClientRect().height,
              classedHeight: classed.getBoundingClientRect().height,
              figureBreakInside: getComputedStyle(fig).breakInside,
            };
          })()`
        )) as { bareHeight: number; classedHeight: number; figureBreakInside: string };

        // The bare image is capped to --gp-content-h (less the 4px cushion);
        // give the sizing algorithm a little slack rather than asserting an
        // exact sub-pixel value.
        expect(measured.bareHeight).toBeLessThanOrEqual(CONTENT_H_PX);
        expect(measured.bareHeight).toBeGreaterThan(CONTENT_H_PX - 20);

        // The :not([class]) guard means the SAME art, merely classed, is
        // governed by its own rule (here .gp-full's width:100%) instead —
        // its natural aspect ratio at that width is far taller than the cap.
        expect(measured.classedHeight).toBeGreaterThan(measured.bareHeight * 2);

        expect(measured.figureBreakInside).toBe("avoid");
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
