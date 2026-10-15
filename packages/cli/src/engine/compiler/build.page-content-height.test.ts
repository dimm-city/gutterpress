import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocumentProxy } from "unpdf";

import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getTextPass, type TextRun } from "../../lib/pdf-inspect.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * The compiler must publish each page context's CONTENT height as
 * `--gp-content-h`, because MARKER_CSS's `:where(.page, .spread)` rule turns
 * that number into the page root's box — which is what makes a pinned
 * element resolve against the PAGE rather than against its own prose. For a
 * root with edge pins that context is the generated one whose pinned margins
 * are freed (shared/pin-edges.ts), so the root fills the page area to the
 * paper, gets the freed margins back as padding (its text keeps the author's
 * content box), and pins inside it on the printer's art-safe line — or on the
 * paper with `.gp-flush`.
 *
 * Measured in the shipped PDF, not in a fixture with a hand-written height:
 * a fixture height is exactly the assumption that would let this regress
 * silently, because a hand-written height hides the missing publication.
 *
 * The art-safe line comes from the book's print area, the
 * `<meta name="gp-print-area">` the markdown assembly writes into every book;
 * these fixtures carry one like the dtrpg preset's (a 9pt bleed, art 18pt in
 * from the trim, 36pt at the binding).
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;

// px in the fixture, pt in the PDF (1px = 0.75pt).
const PX_TO_PT = 0.75;
const SHEET_H = 480;
const DEFAULT_MARGIN = 24;
const ART_MARGIN = 60;

// pt: a 288 x 360pt sheet (384 x 480px); the art-safe line 9 + 18 = 27pt in
// from the sheet on the top, bottom and outside edge, 36pt at the binding
const ART_LINE_PT = 27;
const PRINT_AREA = `<meta name="gp-print-area" content='{"width":288,"height":360,"bleed":9,"safe":36,"artSafe":18}'>`;

const fixture = `<!doctype html><meta charset="utf-8">${PRINT_AREA}<style>
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
 * The other half of pinning art to an edge: the engine frees that edge's
 * margin, and a margin box lives in the margin — so the engine must re-home
 * that edge's furniture into the page area, at its original coordinates,
 * with the values Chromium would have printed. Measured against the field
 * guide's exact shape: universal side-mirrored folios + chapter string in the
 * bottom corners, a NAMED page with its own top furniture and margins, and a
 * bottom-flush pin on that named page.
 *
 * Every assertion here is a "nothing is lost" claim:
 *  - the named page's own furniture and margins survive on the pinned page
 *    (the alias copies), pixel-equal to the unpinned sibling page;
 *  - the freed edge's folio + chapter string PRINT, at the same y as the
 *    native folios on ordinary pages, mirrored for the correct side;
 *  - the art reaches the trim, the page count is stable, and no diagnostics
 *    fire.
 */
testIf(
  "a pinned edge's furniture is relocated into the page, not lost",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-pin-furniture-"));
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
      const p2 = await itemsOn(2); // named verso, no pin
      const p3 = await itemsOn(3); // named recto, PINNED
      const p4 = await itemsOn(4); // plain verso

      // Native furniture on ordinary pages, as a baseline.
      const nativeFolioY = find(p1, "P.1").y;
      find(p1, "C.");
      find(p4, "P.4");

      // The named page's own furniture and margins survive the pin: the
      // pinned page's head sits exactly where the unpinned sibling's does.
      expect(find(p3, "PROFILE").y).toBeCloseTo(find(p2, "PROFILE").y, 1);

      // The freed edge's furniture PRINTS, at the native folio's own y.
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
  "a pinned foot sits on the art-safe line whatever the page's margins, and on the paper with .gp-flush",
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
      // y IS its distance from the sheet's bottom edge. A pinned foot's
      // baseline sits within one line above its pin box's foot; the
      // regression shape (a shrink-wrapped page root) puts it up near the
      // page head, ~300pt away, so the tolerance below has no chance of
      // hiding it.
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

      // The foot sits on the art-safe line, 27pt in from the paper, on the
      // default page (18pt margins) and on the named page (45pt margins)
      // alike: the pinned edge's margin is freed and the pin box inset by the
      // printer's line, not by the book's margin. Both pages' roots fill
      // their generated page areas, which proves the per-context publication.
      expect(defaultFoot).toBeGreaterThanOrEqual(ART_LINE_PT);
      expect(defaultFoot).toBeLessThan(ART_LINE_PT + lineHeightPt);
      expect(artFoot).toBeGreaterThanOrEqual(ART_LINE_PT);
      expect(artFoot).toBeLessThan(ART_LINE_PT + lineHeightPt);

      // Art on the PAPER, driven by the image's own classes: the engine frees
      // the pinned edge's margin on a generated named page, which grows the
      // page AREA, which this build publishes as a taller `--gp-content-h`,
      // which stretches the page root to the sheet's edge; `.gp-flush` drops
      // the art-safe inset. Nothing in the markdown but classes on the image
      // — that is the whole point, since the desktop editor sets image
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

/**
 * The print twin of the viewer's `pin-box.test.ts`, on the same book shape: a
 * 400x500px page with mirrored margins (recto L50/R30, verso L30/R50, the same
 * 320px content box) and page roots the book pads 10px 12px, eight one-page
 * roots with the same paragraph, pinned nowhere, at the bottom, at the
 * bottom-right, and the same with `.gp-flush`, each on a recto and on a
 * verso. In pt the sheet is 300 x 375, the art-safe line 27pt in from the
 * sheet on the top, bottom and outside edge and 36pt at the binding (the
 * right of a verso).
 *
 * A right pin is the case that needs the side: print gives a verso a wider
 * page area once its right margin is freed, so only the verso's own padding
 * keeps its text on the author's lines — the compiler measures where the root
 * landed and corrects it (`setPinGeometry`).
 */
const TWIN_PARAGRAPH =
  "The text block never moves: art pinned to the page sits in a box of its own, so these words wrap at the same places on every page, whatever is pinned where.";
const twinBook = (pins: boolean) => {
  const art = (n: number, classes: string) =>
    pins ? `<p class="art gp-pin ${classes}">ART${n}</p>` : "";
  const pages = [
    "",
    "",
    "gp-bottom",
    "gp-bottom",
    "gp-bottom gp-right",
    "gp-bottom gp-right",
    "gp-bottom gp-flush",
    "gp-bottom gp-right gp-flush",
  ]
    .map((classes, i) => `<div class="page"><p>${TWIN_PARAGRAPH}</p>${classes ? art(i + 1, classes) : ""}</div>`)
    .join("\n");
  return `<!doctype html><meta charset="utf-8">
<meta name="gp-print-area" content='{"width":300,"height":375,"bleed":9,"safe":36,"artSafe":18}'><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 400px 500px; margin: 40px; }
@page :left  { margin-left: 30px; margin-right: 50px; }
@page :right { margin-left: 50px; margin-right: 30px; }
.page { padding: 10px 12px; }
p { margin: 0; font: 12px/1.25 monospace; }
.art { font: 12px/1 monospace; }
</style>
${pages}`;
};

testIf(
  "print: a pin never moves the text, sits on the art-safe line of its edges, and on the paper with .gp-flush — recto and verso",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-pin-box-"));
    const browser = await launchChromium();
    try {
      const runs = async (pins: boolean): Promise<{ pageCount: number; pages: TextRun[][] }> => {
        const file = path.join(dir, `book-${pins}.html`);
        await fsp.writeFile(file, twinBook(pins), "utf8");
        const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
        expect(result.diagnostics).toEqual([]);
        const { runsByPage } = await getTextPass(await getDocumentProxy(result.bytes));
        return { pageCount: result.pageCount, pages: runsByPage };
      };
      const pinned = await runs(true);
      const bare = await runs(false);
      expect(pinned.pageCount).toBe(8);
      expect(bare.pageCount).toBe(8);

      const round = (v: number) => Math.round(v * 10) / 10;
      const textOf = (page: TextRun[]) =>
        page.filter((r) => !r.s.startsWith("ART")).map((r) => ({ s: r.s, x: round(r.x), y: round(r.y) }));
      const artOf = (pages: TextRun[][], n: number) => pages[n - 1]!.find((r) => r.s.startsWith(`ART${n}`))!;

      // The text: every line where the same book without a pin prints it, and
      // the same on every recto and on every verso, at each side's own margin.
      for (let n = 1; n <= 8; n++) expect(textOf(pinned.pages[n - 1]!)).toEqual(textOf(bare.pages[n - 1]!));
      for (const n of [3, 5, 7]) expect(textOf(pinned.pages[n - 1]!)).toEqual(textOf(pinned.pages[0]!));
      for (const n of [4, 6, 8]) expect(textOf(pinned.pages[n - 1]!)).toEqual(textOf(pinned.pages[1]!));
      // each side's margin plus the root's own 12px padding
      expect(textOf(pinned.pages[0]!)[0]!.x).toBeCloseTo((50 + 12) * PX_TO_PT, 0);
      expect(textOf(pinned.pages[1]!)[0]!.x).toBeCloseTo((30 + 12) * PX_TO_PT, 0);
      expect(textOf(pinned.pages[0]!).length).toBeGreaterThan(2); // several lines: a wider box would rewrap them

      // The art: a baseline within one line above its pin box's foot, and a
      // right edge on the line it was pinned to.
      const lineHeightPt = 12 * PX_TO_PT;
      const foot = (n: number, linePt: number) => {
        const y = artOf(pinned.pages, n).y;
        expect(y).toBeGreaterThanOrEqual(linePt);
        expect(y).toBeLessThan(linePt + lineHeightPt);
      };
      const rightGap = (n: number) => {
        const run = artOf(pinned.pages, n);
        return 300 - (run.x + run.w);
      };
      for (const n of [3, 4, 5, 6]) foot(n, ART_LINE_PT);
      expect(rightGap(5)).toBeCloseTo(27, 0); // a recto's outside edge
      expect(rightGap(6)).toBeCloseTo(36, 0); // a verso's binding: no bleed there
      foot(7, 0);
      foot(8, 0);
      expect(rightGap(8)).toBeCloseTo(0, 0);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
