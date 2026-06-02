import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { readPdfBytes } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.transparency",
  name: "Transparency",
  description:
    "Checks for transparency markers (/Transparency, /SMask, /BM) in the PDF",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.forbidTransparency) return [];

    // Raw byte scan — in-process replacement for the previous `grep -ao` usage
    // (same uncompressed-bytes-only behavior). Unreadable file → no findings.
    const bytes = await readPdfBytes(ctx.pdfPath).catch(() => "");

    const found: string[] = [];
    if (bytes.includes("/Transparency")) found.push("Transparency group");
    if (bytes.includes("/SMask")) found.push("Soft mask (SMask)");
    if (bytes.includes("/BM /")) found.push("Blend mode");

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
