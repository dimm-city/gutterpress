import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { readFile } from "node:fs/promises";
import { execCapture } from "../../lib/exec";
import { iccProfileDescription } from "../../lib/icc-profile";
import {
  getPdfxOutputIntentIssues,
  parseQpdfObjectsJson,
} from "./pdfx-structure";

const check: Check = {
  id: "pdf.print.pdfx-markers",
  name: "PDF/X Markers",
  description: "Checks PDF/X OutputIntent structure via qpdf JSON",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["qpdf"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    try {
      const { stdout } = await execCapture("qpdf", [
        // Pin JSON v1: qpdf 11+ defaults to JSON v2, where --json-key=objects is
        // rejected ("only valid for json version 1"). --json=1 works on qpdf
        // 9.1.1+ and yields the { objects: {...} } shape the parser expects.
        "--json=1",
        "--json-key=objects",
        ctx.pdfPath,
      ]);
      const objects = parseQpdfObjectsJson(stdout);

      if (!objects) {
        return [
          inspectionFailed(
            check.id,
            "Unable to parse qpdf JSON output for PDF/X checks.",
            { file: ctx.pdfPath }
          ),
        ];
      }

      const description = await outputProfileDescription(ctx.pdfPath);
      return getPdfxOutputIntentIssues(objects, description).map((message) =>
        finding(check.id, {
          severity: "error",
          message,
          file: ctx.pdfPath,
        })
      );
    } catch {
      // A thrown qpdf (missing tool / non-zero exit) is an INSPECTION failure,
      // not a PDF/X non-conformance — surface it as a warning, not a hard error.
      return [
        inspectionFailed(
          check.id,
          "Failed to inspect PDF objects with qpdf for PDF/X markers.",
          { file: ctx.pdfPath }
        ),
      ];
    }
  },
};

/**
 * The ICC description of the first OutputIntent's `/DestOutputProfile`, read
 * with pdf-lib: qpdf's object JSON leaves stream data out. `undefined` when
 * there is none to read.
 */
async function outputProfileDescription(pdfPath: string): Promise<string | undefined> {
  const { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } =
    await import("pdf-lib");
  try {
    const doc = await PDFDocument.load(await readFile(pdfPath), { updateMetadata: false });
    const intent = doc.catalog.lookupMaybe(PDFName.of("OutputIntents"), PDFArray)?.lookup(0);
    const profile =
      intent instanceof PDFDict ? intent.lookup(PDFName.of("DestOutputProfile")) : undefined;
    if (!(profile instanceof PDFRawStream)) return undefined;
    return iccProfileDescription(decodePDFRawStream(profile).decode());
  } catch {
    return undefined;
  }
}

registerCheck(check);
export default check;
