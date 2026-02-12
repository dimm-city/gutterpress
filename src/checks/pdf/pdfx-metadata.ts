import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.print.pdfx-metadata",
  name: "PDF/X Metadata",
  description: "Verifies XMP metadata and output intent profile",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    try {
      const { stdout } = await execCapture("qpdf", [
        "--list-all-objects",
        ctx.pdfPath,
      ]);

      const results: CheckResult[] = [];

      // Check for output intent
      const hasOutputIntent = /\/OutputIntent/.test(stdout);
      if (!hasOutputIntent) {
        results.push({
          checkId: check.id,
          severity: "info",
          message: "No OutputIntent found in PDF metadata.",
          file: ctx.pdfPath,
        });
      }

      // Check for XMP metadata stream
      const hasXmp = /\/Metadata/.test(stdout);
      if (!hasXmp) {
        results.push({
          checkId: check.id,
          severity: "info",
          message: "No XMP metadata stream found in PDF.",
          file: ctx.pdfPath,
        });
      }

      return results;
    } catch {
      return [];
    }
  },
};

registerCheck(check);
export default check;
