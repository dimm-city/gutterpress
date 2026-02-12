import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.structure.qpdf",
  name: "QPDF Structure",
  description: "Validates PDF structural integrity using qpdf --check",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    try {
      await execCapture("qpdf", ["--check", ctx.pdfPath]);
      return [];
    } catch {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "qpdf reported structural issues in the PDF.",
          file: ctx.pdfPath,
        },
      ];
    }
  },
};

registerCheck(check);
export default check;
