/**
 * Real Chromium -> real Ghostscript: `pdfx.transparency: preserve-text` keeps
 * live text on pages whose artwork needs transparency (soft `rgba()` shadows),
 * leaves pages without transparency alone, and leaves pages whose TEXT is
 * translucent or blended to Ghostscript's whole-page flattening. Skips when Chromium or Ghostscript is absent
 * (CI fails on a missing one via ci-preconditions.test.ts).
 */
import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PDFArray, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { resolveChromiumExecutable } from "./chromium";
import { launchChromium } from "../engine/shared/cdp";
import { build } from "../engine/compiler/build";
import { runBuild } from "./build-runner";
import { log } from "../utils/logger";
import { getAssetPath } from "./embedded-assets";
import { blackTextToGray } from "./black-text-gray";
import { loadPdf, getOpPass, getTextPass, pagesWithUnsplittableText } from "./pdf-inspect";
import {
  convertToPdfxCmyk,
  flattenTransparentPages,
  resolveGhostscript,
  transparentPages,
} from "./ghostscript";
import { makeTempDir, meanAbsDiff, rasterizePdfPage } from "../test-helpers/testkit";

const chromium = await resolveChromiumExecutable();
const ghostscript = await resolveGhostscript();
const testIf = chromium && ghostscript ? test : test.skip;
if (!chromium || !ghostscript) {
  console.warn(
    `[ghostscript.flatten.integration.test] Skipping: ${!chromium ? "no Chromium" : "no Ghostscript"} resolved.`
  );
}

// Six one-page sections. Which `pdfx.transparency: preserve-text` does with each:
//   1, 3  soft shadow + plain text            -> split, text live
//   2     plain text only. Chromium wraps EVERY page in an alpha-1 group once the
//         document blends anywhere (page 6), so this one counts as transparent
//         too                                  -> split, text live
//   4     opaque box OVER text + unrelated soft shadow -> split (the documented
//         limit: the covered words show through; default mode keeps occlusion)
//   5     translucent text (opacity .15)       -> falls back, left untouched
//   6     multiply-blended text on yellow      -> falls back, left untouched
const HTML = `<!doctype html><meta charset="utf-8"><style>
@page { size: 300px 400px; margin: 30px }
body { font: bold 26px/1.2 sans-serif; margin: 0; color: #000 }
section { break-after: page }
.card { margin-top: 40px; padding: 16px; background: #fff;
  box-shadow: 0 12px 24px rgba(0, 0, 0, .45) }
.cover { position: relative; height: 40px }
.cover i { position: absolute; inset: 0; background: #c00 }
.faint { opacity: .15 }
.yellow { background: #ffff00; padding: 10px }
.multiply { color: #00ffff; mix-blend-mode: multiply }
</style>
<section><div class="card">Card one</div></section>
<section><p>Plain page two</p></section>
<section><div class="card">Card three</div></section>
<section><div class="cover">COVERED WORDS<i></i></div><div class="card" style="margin-top:120px">Card four</div></section>
<section><p class="faint">Faint five</p><div class="card">Card five</div></section>
<section><div class="yellow"><span class="multiply">Multiply six</span></div><div class="card">Card six</div></section>`;

const boxOf = (doc: PDFDocument, page: number, name: string) =>
  (doc.getPage(page).node.lookup(PDFName.of(name)) as PDFArray)
    .asArray()
    .map((n) => (n as PDFNumber).asNumber());

/** A page's content stream(s) as comparable text. */
function contentOf(doc: PDFDocument, page: number): string {
  const contents = doc.getPage(page).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((s) => Buffer.from((doc.context.lookup(s as never) as unknown as { contents: Uint8Array }).contents).toString("latin1"))
    .join("\n");
}

testIf(
  "preserve-text splits only eligible transparent pages and keeps their appearance",
  async () => {
    const dir = await makeTempDir("gp-flatten-");
    const browser = await launchChromium();
    try {
      const file = join(dir, "book.html");
      await writeFile(file, HTML, "utf8");
      const built = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      // Page boxes are set earlier in the real pipeline; stand in for that.
      const srcDoc = await PDFDocument.load(built.bytes);
      for (const page of srcDoc.getPages()) {
        page.setTrimBox(6, 6, 213, 288);
        page.setBleedBox(3, 3, 219, 294);
      }
      srcDoc.setTitle("Flatten fixture");
      // `source.pdf` is never written again: every comparison below is against it.
      const sourcePdf = join(dir, "source.pdf");
      const rawPdf = join(dir, "raw.pdf");
      await writeFile(sourcePdf, await srcDoc.save());
      await copyFile(sourcePdf, rawPdf);
      const sourceBytes = await readFile(sourcePdf);

      const transparent = await transparentPages(sourceBytes);
      expect(transparent).toEqual([1, 2, 3, 4, 5, 6]);
      // Chromium wraps opacity and blended text in a group form XObject.
      const blocked = await pagesWithUnsplittableText(sourceBytes);
      expect(blocked).toEqual([5, 6]);
      const split = transparent.filter((n) => !blocked.includes(n));
      expect(split).toEqual([1, 2, 3, 4]);

      await flattenTransparentPages(rawPdf, split, dir);

      const flat = await PDFDocument.load(await readFile(rawPdf));
      expect(flat.getPageCount()).toBe(6);
      expect(flat.getTitle()).toBe("Flatten fixture");
      for (let i = 0; i < 6; i++) {
        expect(boxOf(flat, i, "TrimBox")).toEqual(boxOf(srcDoc, i, "TrimBox"));
        expect(boxOf(flat, i, "BleedBox")).toEqual(boxOf(srcDoc, i, "BleedBox"));
        expect(boxOf(flat, i, "MediaBox")).toEqual(boxOf(srcDoc, i, "MediaBox"));
      }
      // Fallback pages are untouched: identical content, identical pixels.
      for (const n of [5, 6]) {
        expect(contentOf(flat, n - 1)).toBe(contentOf(srcDoc, n - 1));
        const before = rasterizePdfPage(ghostscript!, sourcePdf, dir, `src${n}`, n);
        const after = rasterizePdfPage(ghostscript!, rawPdf, dir, `raw${n}`, n);
        expect(meanAbsDiff(before, after)).toBe(0);
      }
      // The split pages look like their untouched source (before any CMYK step).
      for (const n of [1, 2, 3]) {
        const before = rasterizePdfPage(ghostscript!, sourcePdf, dir, `src${n}`, n);
        const after = rasterizePdfPage(ghostscript!, rawPdf, dir, `raw${n}`, n);
        expect(meanAbsDiff(before, after)).toBeLessThan(1);
      }
      expect(await transparentPages(await readFile(rawPdf))).toEqual([5, 6]);

      const converted = join(dir, "pdfx.pdf");
      await writeFile(rawPdf, await blackTextToGray(await readFile(rawPdf)));
      await convertToPdfxCmyk(rawPdf, converted, {
        iccPath: await getAssetPath("profiles/CGATS21_CRPC1.icc"),
        pdfx: "x1a",
        title: "Flatten fixture",
        stagingDir: dir,
      });

      const bytes = (await readFile(converted)).toString("latin1");
      expect(bytes).not.toContain("/SMask");
      expect(bytes).not.toContain("/Transparency");
      expect(bytes).not.toMatch(/\/ca\s+0?\.\d/);

      const out = await PDFDocument.load(await readFile(converted));
      expect(out.getPageCount()).toBe(6);
      for (let i = 0; i < 6; i++) {
        const trim = boxOf(out, i, "TrimBox").map((n) => Math.round(n * 10) / 10);
        expect(trim).toEqual([6, 6, 219, 294]);
      }

      const pdf = await loadPdf(converted);
      expect(pdf).not.toBeNull();
      const { textByPage } = await getTextPass(pdf!);
      expect(textByPage[0]).toContain("Card one");
      expect(textByPage[1]).toContain("Plain page two");
      expect(textByPage[2]).toContain("Card three");
      expect(textByPage[3]).toContain("COVERED WORDS");
      // Fallback pages: Ghostscript rasterized the whole page, as in default mode.
      expect(textByPage[4]).not.toContain("Faint five");
      expect(textByPage[5]).not.toContain("Multiply six");
      const { fonts, imagesByPage } = await getOpPass(pdf!);
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.every((f) => f.embedded)).toBe(true);
      expect(imagesByPage.get(1)?.length).toBe(1);

      // Every page, fallback ones included, still looks like the untouched
      // source after CMYK conversion (the old text pass printed the faint
      // text solid black and the multiplied text cyan instead of green).
      for (let n = 1; n <= 6; n++) {
        if (n === 4) continue; // split by design: the covered words show through
        const before = rasterizePdfPage(ghostscript!, sourcePdf, dir, `srcc${n}`, n);
        const after = rasterizePdfPage(ghostscript!, converted, dir, `cmyk${n}`, n);
        expect(meanAbsDiff(before, after)).toBeLessThan(8);
      }
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  240_000
);

testIf(
  "flattens a transparent page that has no text (a full-page art plate)",
  async () => {
    const dir = await makeTempDir("gp-flatten-art-");
    const browser = await launchChromium();
    try {
      const file = join(dir, "book.html");
      await writeFile(
        file,
        `<!doctype html><meta charset="utf-8"><style>
@page { size: 300px 400px; margin: 30px }
section { break-after: page; font: 14px serif }
.plate { height: 200px; background: #fff; box-shadow: 0 12px 24px rgba(0, 0, 0, .45) }
</style>
<section><div class="plate"></div></section>
<section><p>Text after the plate.</p></section>`,
        "utf8"
      );
      const built = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const rawPdf = join(dir, "raw.pdf");
      await writeFile(rawPdf, built.bytes);

      expect(await transparentPages(await readFile(rawPdf))).toEqual([1]);
      const plainBefore = contentOf(await PDFDocument.load(built.bytes), 1);
      await flattenTransparentPages(rawPdf, [1], dir);
      // The page with no transparency is byte-identical.
      expect(contentOf(await PDFDocument.load(await readFile(rawPdf)), 1)).toBe(plainBefore);

      expect(await transparentPages(await readFile(rawPdf))).toEqual([]);
      const pdf = await loadPdf(rawPdf);
      const { imagesByPage } = await getOpPass(pdf!);
      expect(imagesByPage.get(1)?.length).toBe(1);
      const { textByPage } = await getTextPass(pdf!);
      expect(textByPage[1]).toContain("Text after the plate");
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  240_000
);

// Skia emits a Type 3 font (glyphs as vector paths) for the synthetic bold of a
// single-weight font. The text pass's -dFILTERVECTOR strips those paths, so a
// split page would print nothing there even though pdftotext still finds the
// words: such a page must fall back.
const REGULAR_ONLY_FONT = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
  "/System/Library/Fonts/Supplemental/Courier New.ttf",
  "C:\\Windows\\Fonts\\cour.ttf",
].find((f) => existsSync(f));

(REGULAR_ONLY_FONT ? testIf : test.skip)(
  "a page with synthetic-bold (Type 3) text is not split and keeps its pixels",
  async () => {
    const dir = await makeTempDir("gp-flatten-t3-");
    const browser = await launchChromium();
    try {
      await copyFile(REGULAR_ONLY_FONT!, join(dir, "regular.ttf"));
      const file = join(dir, "book.html");
      await writeFile(
        file,
        `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Single; src: url(regular.ttf); font-weight: 400 }
@page { size: 300px 400px; margin: 30px }
section { break-after: page; font: 24px Single }
.card { margin-top: 40px; padding: 16px; background: #fff; box-shadow: 0 12px 24px rgba(0, 0, 0, .45) }
</style>
<section><div class="card"><b>Synthetic bold</b> regular</div></section>
<section><div class="card">Regular only</div></section>`,
        "utf8"
      );
      const built = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const sourcePdf = join(dir, "source.pdf");
      const rawPdf = join(dir, "raw.pdf");
      await writeFile(sourcePdf, built.bytes);
      await copyFile(sourcePdf, rawPdf);

      expect(await transparentPages(built.bytes)).toEqual([1, 2]);
      expect(await pagesWithUnsplittableText(built.bytes)).toEqual([1]);

      // Splitting page 1 anyway loses the bold glyphs: the pixels prove why it is excluded.
      await flattenTransparentPages(rawPdf, [1], dir);
      const forced = meanAbsDiff(
        rasterizePdfPage(ghostscript!, sourcePdf, dir, "t3src", 1),
        rasterizePdfPage(ghostscript!, rawPdf, dir, "t3forced", 1)
      );
      expect(forced).toBeGreaterThan(0.5);

      // The ordinary page of the same book splits cleanly.
      await copyFile(sourcePdf, rawPdf);
      await flattenTransparentPages(rawPdf, [2], dir);
      expect(
        meanAbsDiff(
          rasterizePdfPage(ghostscript!, sourcePdf, dir, "t3src2", 2),
          rasterizePdfPage(ghostscript!, rawPdf, dir, "t3split2", 2)
        )
      ).toBeLessThan(1);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  240_000
);

// Chromium paints SVG `<text fill="url(#pattern)">` (and gradient text fills)
// with a tiling pattern. The artwork pass drops the glyphs and the text pass
// drops their pattern paint, so a split page would lose the whole wordmark
// while pdftotext still finds it: such a page must fall back.
testIf(
  "a page with pattern-filled text is not split and keeps its pixels",
  async () => {
    const dir = await makeTempDir("gp-flatten-pattern-");
    const browser = await launchChromium();
    try {
      const file = join(dir, "book.html");
      await writeFile(
        file,
        `<!doctype html><meta charset="utf-8"><style>
@page { size: 300px 400px; margin: 30px }
section { break-after: page; font: 16px serif }
.card { margin-top: 20px; padding: 16px; background: #fff; box-shadow: 0 12px 24px rgba(0, 0, 0, .45) }
</style>
<section>
<svg width="200" height="60"><defs><pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse">
<rect width="4" height="8" fill="#d00"/><rect x="4" width="4" height="8" fill="#00d"/></pattern></defs>
<text x="0" y="45" font-size="40" font-weight="700" font-family="sans-serif" fill="url(#p)">PATTERN</text></svg>
<div class="card">Shadow card</div></section>
<section><div class="card">Plain text card</div></section>`,
        "utf8"
      );
      const built = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const sourcePdf = join(dir, "source.pdf");
      const rawPdf = join(dir, "raw.pdf");
      await writeFile(sourcePdf, built.bytes);
      await copyFile(sourcePdf, rawPdf);

      expect(await transparentPages(built.bytes)).toEqual([1, 2]);
      expect(await pagesWithUnsplittableText(built.bytes)).toEqual([1]);

      // Splitting page 1 anyway erases the wordmark: the pixels prove why it is excluded.
      await flattenTransparentPages(rawPdf, [1], dir);
      const forced = meanAbsDiff(
        rasterizePdfPage(ghostscript!, sourcePdf, dir, "patsrc", 1),
        rasterizePdfPage(ghostscript!, rawPdf, dir, "patforced", 1)
      );
      expect(forced).toBeGreaterThan(1);

      // The ordinary page of the same book splits cleanly.
      await copyFile(sourcePdf, rawPdf);
      await flattenTransparentPages(rawPdf, [2], dir);
      expect(
        meanAbsDiff(
          rasterizePdfPage(ghostscript!, sourcePdf, dir, "patsrc2", 2),
          rasterizePdfPage(ghostscript!, rawPdf, dir, "patsplit2", 2)
        )
      ).toBeLessThan(1);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  240_000
);

// The same book through the real `build --format pdfx`, in both modes, against
// the untouched `--format pdf` render of it. The default must keep occlusion
// and appearance (Ghostscript flattens whole pages); `preserve-text` is opt-in.
testIf(
  "pdfx.transparency: flatten-page (default) keeps occlusion, preserve-text is opt-in",
  async () => {
    const dir = await makeTempDir("gp-transparency-e2e-");
    try {
      await mkdir(join(dir, "styles"));
      await writeFile(
        join(dir, "styles", "main.css"),
        `body { font: bold 20px/1.2 sans-serif; color: #000 }
.card { padding: 16px; background: #fff; box-shadow: 0 12px 24px rgba(0, 0, 0, .45) }
.cover { position: relative; height: 300px; font: bold 110px/1 sans-serif }
.cover i { position: absolute; inset: 0; background: #c00 }
.faint { opacity: .15; font-size: 48px }
.vibe { padding: 16px; box-shadow: 0 8px 16px rgba(0, 0, 0, .4);
  background: repeating-linear-gradient(35deg, #ffffcc 0 8pt, #33ccee 8pt 16pt) }
`,
        "utf8"
      );
      await writeFile(
        join(dir, "book.md"),
        `@page

<div class="card">Card one</div>

@page

<div class="cover">COVERED WORDS<i></i></div>

<div class="card" style="margin-top:40px">Card two</div>

@page

<p class="faint">Faint three</p>

@page

<div class="vibe">Vibe four</div>
`,
        "utf8"
      );
      const manifest = (pdfx: string) =>
        writeFile(
          join(dir, "manifest.yaml"),
          `title: Transparency e2e\nauthors: [T]\nstyles: [styles/main.css]\npreset: dtrpg\n${pdfx}`,
          "utf8"
        );
      const buildTo = async (format: "pdf" | "pdfx", name: string) => {
        const result = await runBuild({
          inputDir: dir,
          format,
          outDir: join(dir, name),
          skipLint: true,
          skipPreValidate: true,
          skipPostValidate: true,
          rawArgs: {},
        });
        return result.pdfPath!;
      };

      await manifest("");
      const source = await buildTo("pdf", "src");
      const warn = spyOn(log, "warn");
      const flat = await buildTo("pdfx", "default");
      await manifest("pdfx:\n  transparency: preserve-text\n");
      const kept = await buildTo("pdfx", "preserve");
      const warnings = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
      // The gradient page has a shadow, so Ghostscript flattens it whole: the
      // warning names the text loss, not a blank gradient.
      expect(warnings.filter((w) => w.startsWith("Page 4: a repeating-*-gradient() or conic-gradient() is painted only"))).toHaveLength(2);
      expect(warnings.some((w) => w.includes("can print blank"))).toBe(false);

      const textOf = async (file: string) => (await getTextPass((await loadPdf(file))!)).textByPage;
      const defaultText = await textOf(flat);
      const preserveText = await textOf(kept);
      // Default: every transparent page is rasterized whole, as before.
      expect(defaultText.slice(0, 3).join("")).toBe("");
      // Opt-in: the shadow pages keep their text; the translucent-text page falls back.
      expect(preserveText[0]).toContain("Card one");
      expect(preserveText[1]).toContain("Card two");
      expect(preserveText[2] ?? "").not.toContain("Faint three");
      // A repeating gradient (#386) is a PostScript-function shading the
      // artwork raster pass distorts, so its page falls back too.
      expect(preserveText[3] ?? "").not.toContain("Vibe four");

      const diff = (file: string, n: number) =>
        meanAbsDiff(
          rasterizePdfPage(ghostscript!, source, dir, `s${n}`, n),
          rasterizePdfPage(ghostscript!, file, dir, `f${n}`, n)
        );
      // Default mode: the red box still hides "COVERED WORDS" (page 2).
      const defaultCovered = diff(flat, 2);
      expect(defaultCovered).toBeLessThan(4);
      // preserve-text: documented limit, the covered words print on top of the box.
      expect(diff(kept, 2)).toBeGreaterThan(defaultCovered + 1);
      // The translucent-text page looks the same in both modes, and like the source.
      expect(diff(flat, 3)).toBeLessThan(3);
      expect(diff(kept, 3)).toBeLessThan(3);
      // The gradient page goes through the same whole-page path in both modes,
      // so the two PDF/X outputs match each other. (Against the RGB source the
      // CMYK conversion alone moves colour by more than 1 on some Ghostscript
      // versions, so that is not the equivalence check.)
      const between = meanAbsDiff(
        rasterizePdfPage(ghostscript!, flat, dir, "g-flat", 4),
        rasterizePdfPage(ghostscript!, kept, dir, "g-kept", 4)
      );
      expect(between).toBeLessThan(0.1);
      // ...and keep the source's page geometry.
      const sizeOf = async (file: string) =>
        (await PDFDocument.load(await readFile(file), { updateMetadata: false })).getPage(3).getSize();
      expect(await sizeOf(kept)).toEqual(await sizeOf(source));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  240_000
);
