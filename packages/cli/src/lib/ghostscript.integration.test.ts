import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFStream,
  rgb,
} from "pdf-lib";
import { execCapture } from "./exec";
import { getAssetPath } from "./embedded-assets";
import { convertToPdfxCmyk, resolveGhostscript } from "./ghostscript";
import { parseInkCov } from "./pdf-parse";

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

      const versionResult = await execCapture(ghostscript!, ["--version"]);
      const version = (versionResult.stdout || versionResult.stderr)
        .trim()
        .split(/\r?\n/)[0];
      const inkResult = await execCapture(ghostscript!, [
        "-q",
        "-dBATCH",
        "-dNOPAUSE",
        "-sDEVICE=inkcov",
        "-sOutputFile=-",
        outputPdf,
      ]);
      const coverage = parseInkCov(`${inkResult.stdout}\n${inkResult.stderr}`);
      expect(coverage).toHaveLength(1);
      const [red] = coverage;
      expect(red!.c).toBeLessThan(0.25);
      expect(red!.m).toBeGreaterThan(0.7);
      expect(red!.y).toBeGreaterThan(0.7);
      expect(red!.k).toBeLessThan(0.25);

      console.info(
        `[ghostscript.integration.test] Ghostscript ${version}; RGB red -> C=${red!.c.toFixed(5)} M=${red!.m.toFixed(5)} Y=${red!.y.toFixed(5)} K=${red!.k.toFixed(5)}`
      );
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  },
  60_000
);
