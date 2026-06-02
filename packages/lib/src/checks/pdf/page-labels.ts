import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getPageLabels } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.nav.page-labels",
  name: "Page Labels",
  description: "Verifies PDF page labels / folio numbering",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    const labels = await getPageLabels(doc);
    return [
      {
        checkId: check.id,
        severity: "info",
        message:
          labels && labels.length > 0
            ? "PDF contains page labels."
            : "PDF does not contain explicit page labels.",
        file: ctx.pdfPath,
      },
    ];
  },
};

registerCheck(check);
export default check;
