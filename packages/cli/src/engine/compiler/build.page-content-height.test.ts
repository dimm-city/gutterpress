import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocumentProxy } from "unpdf";

import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * The compiler must publish each page context's CONTENT height as
 * `--gp-content-h`, because MARKER_CSS's `:where(.page, .spread)` rule turns
 * that number into the page root's box — which is what makes a pinned
 * element resolve against the PAGE rather than against its own prose.
 *
 * Measured in the shipped PDF, not in a fixture with a hand-written height:
 * a fixture height is exactly the assumption that would let this regress
 * silently, because a hand-written height hides the missing publication.
 *
 * Three page contexts, deliberately: the default page, a named page with
 * taller vertical margins, and a named page whose bottom margin is ZERO. A
 * publication that ignored `@page` names would put every foot at the same
 * height, and two of them would be wrong. The zero-margin page is also the
 * sanctioned recipe for art that must touch the paper's edge — see the
 * user guide's "Pinned images" section.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;

// px in the fixture, pt in the PDF (1px = 0.75pt).
const PX_TO_PT = 0.75;
const SHEET_H = 480;
const DEFAULT_MARGIN = 24;
const ART_MARGIN = 60;

const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px ${SHEET_H}px; margin: ${DEFAULT_MARGIN}px; }
@page art { size: 384px ${SHEET_H}px; margin: ${ART_MARGIN}px ${DEFAULT_MARGIN}px; }
.art { page: art; }
p { margin: 0; font: 12px/1 monospace; }
</style>
<div class="page"><p>Short prose, nowhere near the page foot.</p>
<p class="gp-pin gp-bottom">FOOTDEFAULT</p></div>
<div class="page art"><p>Short prose, nowhere near the page foot.</p>
<p class="gp-pin gp-bottom">FOOTART</p></div>
<div class="page"><p>Short prose, nowhere near the page foot.</p>
<p class="gp-pin gp-bottom gp-flush">FOOTFLUSH</p></div>
<div class="page"><p>Short prose, nowhere near either edge.</p>
<p class="gp-pin gp-bottom gp-right gp-flush">FOOTCORNER</p></div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.page-content-height.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

/**
 * The other half of `.gp-flush`: it frees the pinned edges' margins, and a
 * margin box lives in the margin — so the engine must re-home that edge's
 * furniture into the page area, at its original coordinates, with the values
 * Chromium would have printed. Measured against the field guide's exact
 * shape: universal side-mirrored folios + chapter string in the bottom
 * corners, a NAMED page with its own top furniture and margins, and a
 * bottom-flush pin on that named page.
 *
 * Every assertion here is a "nothing is lost" claim:
 *  - the named page's own furniture and margins survive on the flushed page
 *    (the alias copies), pixel-equal to the unflushed sibling page;
 *  - the flushed edge's folio + chapter string PRINT, at the same y as the
 *    native folios on ordinary pages, mirrored for the correct side;
 *  - the art reaches the trim, the page count is stable, and no diagnostics
 *    fire.
 */
testIf(
  "flushed-edge furniture is relocated into the page, not lost",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-flush-furniture-"));
    const browser = await launchChromium();
    try {
      const withFurniture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px ${SHEET_H}px; margin: ${DEFAULT_MARGIN}px; }
@page :left  { @bottom-left { content: "P." counter(page); font: 9px monospace; } @bottom-right { content: "C." string(sect, first); font: 9px monospace; } }
@page :right { @bottom-left { content: "C." string(sect, first); font: 9px monospace; } @bottom-right { content: "P." counter(page); font: 9px monospace; } }
@page profile { margin-top: 60px; @top-center { content: "PROFILE HEAD"; font: 9px monospace; } }
.profile { page: profile; }
h2 { string-set: sect content(); margin: 0; font: 14px/1 monospace; }
p { margin: 0; font: 12px/1 monospace; }
</style>
<div class="page"><h2>01</h2><p>Plain page one.</p></div>
<div class="page profile"><p>Named page, no flush.</p></div>
<div class="page profile"><p>Named page WITH flush.</p>
<p class="gp-pin gp-bottom gp-flush">ARTFOOT</p></div>
<div class="page"><p>Plain page after.</p></div>`;
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, withFurniture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      expect(result.pageCount).toBe(4);
      expect(result.diagnostics).toEqual([]);

      const doc = await getDocumentProxy(result.bytes);
      const itemsOn = async (pageNumber: number) => {
        const tc = await (await doc.getPage(pageNumber)).getTextContent();
        return tc.items
          .map((i) => i as { str: string; transform: number[] })
          .filter((i) => i.str.trim())
          .map((i) => ({ str: i.str, x: i.transform[4]!, y: i.transform[5]! }));
      };
      const find = (items: Awaited<ReturnType<typeof itemsOn>>, needle: string) => {
        const hit = items.find((i) => i.str.includes(needle));
        expect(hit, `expected "${needle}"`).toBeDefined();
        return hit!;
      };

      const p1 = await itemsOn(1); // plain recto — native corners
      const p2 = await itemsOn(2); // named verso, unflushed
      const p3 = await itemsOn(3); // named recto, FLUSHED
      const p4 = await itemsOn(4); // plain verso

      // Native furniture on ordinary pages, as a baseline.
      const nativeFolioY = find(p1, "P.1").y;
      find(p1, "C.");
      find(p4, "P.4");

      // The named page's own furniture and margins survive the flush: the
      // flushed page's head sits exactly where the unflushed sibling's does.
      expect(find(p3, "PROFILE").y).toBeCloseTo(find(p2, "PROFILE").y, 1);

      // The flushed edge's furniture PRINTS, at the native folio's own y.
      // Page 3 is a recto, so the mirror puts the chapter string left and
      // the folio right — same rule the native pages follow.
      const reloFolio = find(p3, "P.3");
      // Content parts concatenate without separators — "C." + string →
      // "C.01" — exactly as the native boxes on p1/p2/p4 render it.
      const reloSect = find(p3, "C.01");
      expect(reloFolio.y).toBeCloseTo(nativeFolioY, 0);
      expect(reloSect.y).toBeCloseTo(nativeFolioY, 0);
      const mid = (384 * PX_TO_PT) / 2;
      expect(reloSect.x).toBeLessThan(mid);
      expect(reloFolio.x).toBeGreaterThan(mid);

      // And the art is on the paper.
      const art = find(p3, "ARTFOOT");
      expect(art.y).toBeGreaterThanOrEqual(0);
      expect(art.y).toBeLessThan(12 * PX_TO_PT);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "a pinned foot lands on the page's bottom margin edge, per page context",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-page-content-h-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      // Stretching page roots must cost no sheets: four short pages stay four.
      expect(result.pageCount).toBe(4);
      // ...and must not overshoot the content box either, which the build's
      // own audit would report against the page roots themselves.
      expect(result.diagnostics.filter((d) => d.code === "engine.content.overheight")).toEqual([]);

      // PDF user space puts the origin at the bottom-left, so a text item's
      // y IS its distance from the sheet's bottom edge. A foot pinned to the
      // page content box sits just above the bottom margin; the regression
      // shape (a shrink-wrapped page root) puts it up near the page head,
      // ~300pt away, so the tolerance below has no chance of hiding it.
      const doc = await getDocumentProxy(result.bytes);
      const footItem = async (
        pageNumber: number,
        word: string,
      ): Promise<{ x: number; y: number; width: number }> => {
        const tc = await (await doc.getPage(pageNumber)).getTextContent();
        const item = tc.items.find((i) => (i as { str?: string }).str?.includes(word)) as
          | { transform: number[]; width: number }
          | undefined;
        expect(item).toBeDefined();
        return { x: item!.transform[4]!, y: item!.transform[5]!, width: item!.width };
      };
      const footY = async (pageNumber: number, word: string): Promise<number> =>
        (await footItem(pageNumber, word)).y;

      const defaultFoot = await footY(1, "FOOTDEFAULT");
      const artFoot = await footY(2, "FOOTART");
      const flushFoot = await footY(3, "FOOTFLUSH");
      const lineHeightPt = 12 * PX_TO_PT;

      // Baseline sits within one line above the content box's bottom edge.
      expect(defaultFoot).toBeGreaterThanOrEqual(DEFAULT_MARGIN * PX_TO_PT);
      expect(defaultFoot).toBeLessThan(DEFAULT_MARGIN * PX_TO_PT + lineHeightPt);
      // The named page's deeper margin moves its foot up by exactly the
      // margin difference — proof the publication is per page context.
      expect(artFoot).toBeGreaterThanOrEqual(ART_MARGIN * PX_TO_PT);
      expect(artFoot).toBeLessThan(ART_MARGIN * PX_TO_PT + lineHeightPt);

      // Art flush with the PAPER, driven by the image's own classes: `.gp-flush`
      // has GUTTERPRESS_CSS assign this page a core-owned named page with the
      // pinned edge's margin zeroed, which grows the page AREA, which this
      // build publishes as a taller `--gp-content-h`, which stretches the page
      // root to the sheet's edge. Nothing in the markdown but classes on the
      // image — that is the whole point, since the desktop editor sets image
      // classes and cannot write `@page` rules.
      //
      // This is also the only mechanism Chromium allows, which is why it is
      // worth a test: reaching the margin any other way (negative insets, a
      // transform) either fragments the pin onto the NEXT sheet or is clipped
      // away entirely at the page area, both measured.
      expect(flushFoot).toBeGreaterThanOrEqual(0);
      expect(flushFoot).toBeLessThan(lineHeightPt);

      // Two edges at once: the corner rule must win over both single-edge
      // rules (they all match), so the foot is flush on the bottom AND the
      // right. The right-hand check reads the text run's own advance width,
      // since a PDF text item is positioned by its start.
      const corner = await footItem(4, "FOOTCORNER");
      expect(corner.y).toBeGreaterThanOrEqual(0);
      expect(corner.y).toBeLessThan(lineHeightPt);
      const sheetWidthPt = 384 * PX_TO_PT;
      expect(sheetWidthPt - (corner.x + corner.width)).toBeLessThan(2);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
