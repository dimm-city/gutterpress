import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFString,
  cmyk,
  rgb,
} from "pdf-lib";
import { execCapture } from "./exec";
import { getAssetPath } from "./embedded-assets";
import { convertToPdfxCmyk, resolveGhostscript } from "./ghostscript";
import { getPerPageInkCoverage } from "./pdf-parse";

const ghostscript = await resolveGhostscript();
const testWithGhostscript = ghostscript ? test : test.skip;

if (!ghostscript) {
  console.warn(
    "[ghostscript.integration.test] Ghostscript unavailable; skipping the real PDF/X color-conversion test. Install Ghostscript or set GHOSTSCRIPT_PATH to run it."
  );
}

testWithGhostscript(
  "real Ghostscript converts an RGB-red PDF to parseable CMYK PDF/X",
  async () => {
    const stage = await mkdtemp(join(tmpdir(), "gutterpress-gs-pdfx-integration-"));
    try {
      const inputPdf = join(stage, "rgb-red.pdf");
      const outputPdf = join(stage, "cmyk-pdfx.pdf");

      const source = await PDFDocument.create();
      const page = source.addPage([144, 144]);
      page.drawRectangle({
        x: 0,
        y: 0,
        width: 144,
        height: 144,
        color: rgb(1, 0, 0),
        borderWidth: 0,
      });
      // The build's three-edge trim (no inset at a recto's binding edge) must
      // survive the conversion.
      page.setTrimBox(0, 9, 135, 126);
      await writeFile(inputPdf, await source.save());

      await convertToPdfxCmyk(inputPdf, outputPdf, {
        iccPath: await getAssetPath("profiles/CGATS21_CRPC1.icc"),
        pdfx: "x1a",
        title: "Ghostscript PDF/X integration",
        stagingDir: stage,
      });

      const bytes = await readFile(outputPdf);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const converted = await PDFDocument.load(bytes);
      expect(converted.getPageCount()).toBe(1);
      const outputIntents = converted.catalog.lookup(
        PDFName.of("OutputIntents"),
        PDFArray
      );
      expect(outputIntents.size()).toBeGreaterThan(0);
      const outputIntent = outputIntents.lookup(0, PDFDict);
      expect(
        outputIntent.lookup(PDFName.of("S"), PDFName).toString()
      ).toBe("/GTS_PDFX");
      const outputProfile = outputIntent.lookup(
        PDFName.of("DestOutputProfile"),
        PDFStream
      );
      expect(
        outputProfile.dict.lookup(PDFName.of("N"), PDFNumber).asNumber()
      ).toBe(4);
      // CGATS 21-2 CRPC1's registry name, not SWOP's (`CGATS TR 001`).
      const identifier = outputIntent.lookup(PDFName.of("OutputConditionIdentifier"));
      expect(
        identifier instanceof PDFString || identifier instanceof PDFHexString
          ? identifier.decodeText()
          : String(identifier)
      ).toBe("CGATS21-2-CRPC1");
      const trim = converted.getPage(0).node.lookup(PDFName.of("TrimBox"), PDFArray);
      expect(trim.asArray().map((n) => (n as PDFNumber).asNumber())).toEqual([0, 9, 135, 126]);

      const versionResult = await execCapture(ghostscript!, ["--version"]);
      const version = (versionResult.stdout || versionResult.stderr)
        .trim()
        .split(/\r?\n/)[0];
      const coverage = await getPerPageInkCoverage(outputPdf);
      if (!coverage.ok) throw new Error(coverage.error);
      expect(coverage.pages).toHaveLength(1);
      const [red] = coverage.pages;
      expect(red!.c).toBeLessThan(25);
      expect(red!.m).toBeGreaterThan(70);
      expect(red!.y).toBeGreaterThan(70);
      expect(red!.k).toBeLessThan(25);

      console.info(
        `[ghostscript.integration.test] Ghostscript ${version}; RGB red -> C=${red!.c.toFixed(1)} M=${red!.m.toFixed(1)} Y=${red!.y.toFixed(1)} K=${red!.k.toFixed(1)}`
      );
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  },
  60_000
);

testWithGhostscript(
  "the conversion separates through CGATS21_CRPC1, not Ghostscript's default CMYK profile",
  async () => {
    const stage = await mkdtemp(join(tmpdir(), "gutterpress-gs-crpc1-integration-"));
    try {
      const inputPdf = join(stage, "rgb-black.pdf");
      const outputPdf = join(stage, "cmyk-black.pdf");
      const source = await PDFDocument.create();
      source
        .addPage([144, 144])
        .drawRectangle({ x: 0, y: 0, width: 144, height: 144, color: rgb(0, 0, 0), borderWidth: 0 });
      await writeFile(inputPdf, await source.save());

      await convertToPdfxCmyk(inputPdf, outputPdf, {
        iccPath: await getAssetPath("profiles/CGATS21_CRPC1.icc"),
        pdfx: "x1a",
        stagingDir: stage,
      });

      // CRPC1 separates #000 to about C47 M42 Y40 K100 = 229%; Ghostscript's
      // default_cmyk.icc gives about C72 M68 Y67 K88 = 295%. A profile that is
      // silently ignored fails here.
      const coverage = await getPerPageInkCoverage(outputPdf);
      if (!coverage.ok) throw new Error(coverage.error);
      const [black] = coverage.pages;
      console.info(
        `[ghostscript.integration.test] RGB #000 -> C=${black!.c.toFixed(1)} M=${black!.m.toFixed(1)} Y=${black!.y.toFixed(1)} K=${black!.k.toFixed(1)} = ${black!.tac.toFixed(1)}%`
      );
      expect(black!.k).toBeGreaterThan(99);
      expect(black!.c).toBeGreaterThanOrEqual(45);
      expect(black!.c).toBeLessThanOrEqual(52);
      expect(black!.tac).toBeLessThanOrEqual(245);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  },
  60_000
);

testWithGhostscript(
  "real Ghostscript measures each page's heaviest spot, so a small 400% patch is seen (#419)",
  async () => {
    const stage = await mkdtemp(join(tmpdir(), "gutterpress-gs-inkcov-integration-"));
    try {
      // Page 1 blank; page 2 white with a 100/100/100/100 CMYK patch on a
      // sixteenth of its area: 0% and 400% TAC. Page 2's MEAN coverage is 25%,
      // which is what the inkcov device measured and the check used to report.
      const pdf = join(stage, "two-pages.pdf");
      const source = await PDFDocument.create();
      source.addPage([144, 144]);
      source
        .addPage([144, 144])
        .drawRectangle({ x: 0, y: 0, width: 36, height: 36, color: cmyk(1, 1, 1, 1), borderWidth: 0 });
      await writeFile(pdf, await source.save());

      const result = await getPerPageInkCoverage(pdf);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0]!.tac).toBeLessThan(1);
      expect(result.pages[1]!.tac).toBeGreaterThan(390);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  },
  60_000
);
