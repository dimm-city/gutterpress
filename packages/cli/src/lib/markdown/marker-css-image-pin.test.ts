import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { resolveChromiumExecutable } from "../chromium.ts";
import { closeBrowser, getBrowser } from "../browser-pool.ts";
import { inspectPdf } from "../../engine/shared/pdf-inspect.ts";

/**
 * Geometry contract for the gp-* pin mode (MARKER_CSS). The parity gate
 * compares page INDICES only — it cannot see where on a page something
 * paints — so this test is the one place the pin geometry is measured in a
 * real Chromium.
 *
 * The three load-bearing pieces of the pin CSS, each with a failure mode
 * this test catches:
 *   - `inset: 0` — abspos self-alignment aligns within the inset-modified
 *     containing block; with auto insets that collapses to the
 *     static-position rectangle and alignment does nothing (case 1 fails).
 *   - explicit `align-self/justify-self: center` — `normal` behaves as
 *     `start` for abspos REPLACED elements, so removing either default
 *     top-lefts the "centered by default" promise (case 1 fails).
 *   - source order: pin-edge modifiers after `.gp-pin`, sizes after the
 *     float rules (cases 2/3/5 fail if reordered).
 *
 * The fixture gives `.page` an explicit height because that is the pin
 * CONTRACT: gp-pin pins within its @page/@spread container (whatever size
 * that container is), NOT "the sheet edge". The PDF assertion at the end
 * proves the out-of-flow pins never perturb fragmentation (5 divs that each
 * exactly fill a sheet still print as exactly 5 sheets).
 */

const RENDER_TEST_TIMEOUT_MS = 60_000;

const PAGE_W = 384;
const PAGE_H = 480;
const IMG_W = 100;
const IMG_H = 200;

const SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${IMG_W}" height="${IMG_H}" viewBox="0 0 100 200"><rect width="100" height="200" fill="#36c"/></svg>`
);
const SRC = `data:image/svg+xml,${SVG}`;
// Square art for the flow-compose case: gp-large makes it 75% of a 384px
// page (288px); with the 1:2 portrait SVG the float would be 576px tall and
// overflow its fixed-height .page onto extra sheets, breaking the
// page-count assertion for a reason that has nothing to do with the CSS
// under test.
const SQ_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#6c3"/></svg>`
);
const SQ_SRC = `data:image/svg+xml,${SQ_SVG}`;

// #p5p's margin is zeroed by FIXTURE CSS (its float + default 16px margin
// would spill past the fixed page height); the pin paragraphs' margins are
// deliberately NOT zeroed here — they must come out 0 via MARKER_CSS's
// :where(p:has(> img.gp-pin:only-child)) neutralizer, which is under test.
const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: ${PAGE_W}px ${PAGE_H}px; margin: 0; }
.page { width: ${PAGE_W}px; height: ${PAGE_H}px; }
#p5p { margin: 0; }
</style>
<div class="page" id="p1"><p id="p1p"><img id="i1" class="gp-pin" src="${SRC}" alt=""></p></div>
<div class="page" id="p2"><p><img id="i2" class="gp-pin gp-top gp-right" src="${SRC}" alt=""></p></div>
<div class="page" id="p3"><p><img id="i3" class="gp-pin gp-bottom gp-left" src="${SRC}" alt=""></p></div>
<div class="page" id="p4"><p><img id="i4" class="gp-pin gp-small" src="${SRC}" alt=""></p></div>
<div class="page" id="p5"><p id="p5p">Wrap copy before the art so the float has a line box to sit in.
<img id="i5" class="gp-right gp-large" src="${SQ_SRC}" alt="">
More copy after the art keeps the paragraph from collapsing.</p></div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[paged-css-image-pin.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "gp-pin centers/edges within its .page container, sizes compose, and pins never perturb fragmentation",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-imgpin-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

        // Evaluated as a source string, not a closure: this package's tsconfig
        // is deliberately DOM-free (see its comment), so `document` has no
        // type here.
        const m = (await page.evaluate(
          `(() => {
            const rel = (imgId, pageId) => {
              const i = document.getElementById(imgId).getBoundingClientRect();
              const p = document.getElementById(pageId).getBoundingClientRect();
              return {
                left: i.left - p.left,
                top: i.top - p.top,
                right: p.right - i.right,
                bottom: p.bottom - i.bottom,
                width: i.width,
                height: i.height,
              };
            };
            const p1p = getComputedStyle(document.getElementById("p1p"));
            return {
              centered: rel("i1", "p1"),
              topRight: rel("i2", "p2"),
              bottomLeft: rel("i3", "p3"),
              small: rel("i4", "p4"),
              flow: {
                float: getComputedStyle(document.getElementById("i5")).float,
                pinnedFloat: getComputedStyle(document.getElementById("i3")).float,
                width: document.getElementById("i5").getBoundingClientRect().width,
              },
              wrapperMargin: { top: p1p.marginTop, bottom: p1p.marginBottom },
            };
          })()`
        )) as {
          centered: { left: number; top: number; right: number; bottom: number; width: number; height: number };
          topRight: { left: number; top: number; right: number; bottom: number };
          bottomLeft: { left: number; top: number; right: number; bottom: number };
          small: { width: number };
          flow: { float: string; pinnedFloat: string; width: number };
          wrapperMargin: { top: string; bottom: string };
        };

        // Case 1: bare .gp-pin is centered on BOTH axes (the abspos
        // `normal`-behaves-as-`start` trap: remove either explicit center
        // from MARKER_CSS and this fails top-left).
        expect(m.centered.left).toBeCloseTo((PAGE_W - IMG_W) / 2, 0);
        expect(m.centered.top).toBeCloseTo((PAGE_H - IMG_H) / 2, 0);
        expect(m.centered.width).toBe(IMG_W);
        expect(m.centered.height).toBe(IMG_H);

        // Case 2: gp-top gp-right — flush against those container edges.
        expect(m.topRight.top).toBeCloseTo(0, 0);
        expect(m.topRight.right).toBeCloseTo(0, 0);

        // Case 3: gp-bottom gp-left — flush the other way, and gp-left's
        // float declaration is neutralized by abspos (computed float: none).
        expect(m.bottomLeft.bottom).toBeCloseTo(0, 0);
        expect(m.bottomLeft.left).toBeCloseTo(0, 0);
        expect(m.flow.pinnedFloat).toBe("none");

        // Case 4: gp-pin gp-small — 25% of the .page padding box.
        expect(m.small.width).toBeCloseTo(PAGE_W * 0.25, 0);

        // Case 5: flow compose — gp-right gp-large floats right at 75% of
        // the paragraph's containing block (the size rule's max-width:100%
        // lifts the floats' 50% cap purely by source order).
        expect(m.flow.float).toBe("right");
        expect(m.flow.width).toBeCloseTo(PAGE_W * 0.75, 0);

        // The <p> wrapping a lone gp-pin image contributes no phantom
        // margin gap to the flow (the :where(p:has(...)) neutralizer).
        expect(m.wrapperMargin.top).toBe("0px");
        expect(m.wrapperMargin.bottom).toBe("0px");

        // Print: five container divs that each exactly fill a sheet print
        // as exactly five sheets — the out-of-flow pins add none.
        const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const facts = await inspectPdf(new Uint8Array(bytes));
        expect(facts.pageCount).toBe(5);
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
