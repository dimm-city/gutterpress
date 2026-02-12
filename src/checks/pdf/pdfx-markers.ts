import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.print.pdfx-markers",
  name: "PDF/X Markers",
  description: "Checks for GTS_PDFXVersion and OutputIntent markers",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const pdfxCheck = await execCapture("grep", [
      "-ao",
      "GTS_PDFX\\|PDF/X-",
      ctx.pdfPath,
    ]).catch(() => ({ stdout: "", stderr: "" }));

    if (
      !pdfxCheck.stdout.includes("GTS_PDFX") &&
      !pdfxCheck.stdout.includes("PDF/X-")
    ) {
      return [
        {
          checkId: check.id,
          severity: "error",
          message:
            "PDF/X markers not found (GTS_PDFXVersion / OutputIntent).",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
