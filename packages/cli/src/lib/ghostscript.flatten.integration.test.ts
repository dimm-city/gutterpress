/**
 * Real Chromium -> real Ghostscript: a PDF/X build keeps live text on pages
 * whose artwork needs transparency (soft `rgba()` shadows), and leaves pages
 * without transparency alone. Skips when Chromium or Ghostscript is absent
 * (CI fails on a missing one via ci-preconditions.test.ts).
 */
import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFArray, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { resolveChromiumExecutable } from "./chromium";
import { launchChromium } from "../engine/shared/cdp";
import { build } from "../engine/compiler/build";
import { getAssetPath } from "./embedded-assets";
import { blackTextToGray } from "./black-text-gray";
import { loadPdf, getOpPass, getTextPass } from "./pdf-inspect";
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

const HTML = `<!doctype html><meta charset="utf-8"><style>
@page { size: 300px 400px; margin: 30px }
body { font: 14px/1.4 serif; margin: 0; color: #000 }
section { break-after: page }
.card { margin-top: 40px; padding: 16px; background: #fff;
  box-shadow: 0 12px 24px rgba(0, 0, 0, .45) }
</style>
<section><div class="card">Soft shadow card page one text.</div></section>
<section><p>Plain page two text, no transparency.</p></section>
<section><div class="card">Soft shadow card page three text.</div></section>`;

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
  "flattens only transparent pages, keeps their text live through PDF/X conversion",
  async () => {
    const dir = await makeTempDir("gp-flatten-");
    const browser = await launchChromium();
    try {
      const file = join(dir, "book.html");
      await writeFile(file, HTML, "utf8");
      const built = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      // Page boxes are set earlier in the real pipeline; stand in for that.
      const src = await PDFDocument.load(built.bytes);
      for (const page of src.getPages()) {
        page.setTrimBox(6, 6, 213, 288);
        page.setBleedBox(3, 3, 219, 294);
      }
      src.setTitle("Flatten fixture");
      const rawPdf = join(dir, "raw.pdf");
      await writeFile(rawPdf, await src.save());

      expect(await transparentPages(await readFile(rawPdf))).toEqual([1, 3]);

      await flattenTransparentPages(rawPdf, [1, 3], dir);

      const flat = await PDFDocument.load(await readFile(rawPdf));
      expect(flat.getPageCount()).toBe(3);
      expect(flat.getTitle()).toBe("Flatten fixture");
      for (let i = 0; i < 3; i++) {
        expect(boxOf(flat, i, "TrimBox")).toEqual([6, 6, 219, 294]);
        expect(boxOf(flat, i, "BleedBox")).toEqual([3, 3, 222, 297]);
        expect(boxOf(flat, i, "MediaBox")).toEqual(boxOf(src, i, "MediaBox"));
      }
      // Page 2 had no transparency: byte-identical content stream.
      expect(contentOf(flat, 1)).toBe(contentOf(src, 1));
      expect(await transparentPages(await readFile(rawPdf))).toEqual([]);

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
      expect(out.getPageCount()).toBe(3);
      for (let i = 0; i < 3; i++) {
        const [x0, y0, x1, y1] = boxOf(out, i, "TrimBox");
        expect([x0, y0, x1, y1].map((n) => Math.round(n! * 10) / 10)).toEqual([6, 6, 219, 294]);
      }

      const pdf = await loadPdf(converted);
      expect(pdf).not.toBeNull();
      const { textByPage } = await getTextPass(pdf!);
      expect(textByPage[0]).toContain("Soft shadow card page one text");
      expect(textByPage[1]).toContain("Plain page two text");
      expect(textByPage[2]).toContain("Soft shadow card page three text");
      const { fonts, imagesByPage } = await getOpPass(pdf!);
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.every((f) => f.embedded)).toBe(true);
      expect(imagesByPage.get(1)?.length).toBe(1);
      expect(imagesByPage.get(2)?.length ?? 0).toBe(0);

      // The merged page still looks like the transparent original.
      const before = rasterizePdfPage(ghostscript!, join(dir, "raw.pdf"), dir, "before");
      const after = rasterizePdfPage(ghostscript!, converted, dir, "after");
      expect(meanAbsDiff(before, after)).toBeLessThan(8);
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
      await flattenTransparentPages(rawPdf, [1], dir);

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
