import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.nav.page-labels",
  name: "Page Labels",
  description: "Verifies PDF page labels / folio numbering",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    try {
      const { stdout } = await execCapture("qpdf", [
        "--list-all-objects",
        ctx.pdfPath,
      ]);
      const hasPageLabels = /\/PageLabels/.test(stdout);

      return [
        {
          checkId: check.id,
          severity: "info",
          message: hasPageLabels
            ? "PDF contains page labels."
            : "PDF does not contain explicit page labels.",
          file: ctx.pdfPath,
        },
      ];
    } catch {
      return [];
    }
  },
};

registerCheck(check);
export default check;
