import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectionFailed } from "../policy";
import { findPdfMarkers } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.transparency",
  name: "Transparency",
  description:
    "Checks for transparency markers (/Transparency, /SMask, /BM) in the PDF",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    // Raw byte scan — in-process replacement for the previous `grep -ao` usage
    // (same uncompressed-bytes-only behavior).
    const markers = {
      "Transparency group": /\/Transparency/,
      "Soft mask (SMask)": /\/SMask/,
      "Blend mode": /\/BM \//,
    };
    let hits;
    try {
      hits = await findPdfMarkers(ctx.pdfPath, markers);
    } catch {
      return [inspectionFailed(check.id, "Could not read the PDF to scan for transparency.", { file: ctx.pdfPath })];
    }
    const found = Object.keys(markers).filter((name) => hits.has(name as keyof typeof markers));

    if (found.length > 0) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: `Transparency detected in PDF: ${found.join(", ")}. This may cause issues with some printers.`,
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
