import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";
import {
  getPdfxMetadataIssues,
  parseQpdfObjectsJson,
} from "./pdfx-structure";

const check: Check = {
  id: "pdf.print.pdfx-metadata",
  name: "PDF/X Metadata",
  description: "Verifies PDF/X DOCINFO metadata via qpdf JSON",
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
          {
            checkId: check.id,
            severity: "error",
            message: "Unable to parse qpdf JSON output for PDF/X metadata checks.",
            file: ctx.pdfPath,
          },
        ];
      }

      return getPdfxMetadataIssues(objects, ctx.config.pdfx.flavor).map((message) => ({
        checkId: check.id,
        severity: "error" as const,
        message,
        file: ctx.pdfPath,
      }));
    } catch {
      return [
        {
          checkId: check.id,
          severity: "error",
          message: "Failed to inspect PDF objects with qpdf for PDF/X metadata.",
          file: ctx.pdfPath,
        },
      ];
    }
  },
};

registerCheck(check);
export default check;
