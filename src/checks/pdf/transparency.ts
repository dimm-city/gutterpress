import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.print.transparency",
  name: "Transparency",
  description:
    "Checks for transparency markers (/Transparency, /SMask, /BM) in the PDF",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["grep"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.forbidTransparency) return [];

    const transparencyCheck = await execCapture("grep", [
      "-ao",
      "/Transparency\\|/SMask\\|/BM /",
      ctx.pdfPath,
    ]).catch(() => ({ stdout: "", stderr: "" }));

    const found: string[] = [];
    if (transparencyCheck.stdout.includes("/Transparency"))
      found.push("Transparency group");
    if (transparencyCheck.stdout.includes("/SMask"))
      found.push("Soft mask (SMask)");
    if (transparencyCheck.stdout.includes("/BM /"))
      found.push("Blend mode");

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
