import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, countLinkAnnotations } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.nav.cross-refs",
  name: "Cross References",
  description: "Counts and verifies internal link annotations",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [
        {
          checkId: check.id,
          severity: "info",
          message: "Could not inspect PDF for cross-references.",
          file: ctx.pdfPath,
        },
      ];
    }

    const linkCount = await countLinkAnnotations(doc);
    return [
      {
        checkId: check.id,
        severity: "info",
        message: `PDF contains ${linkCount} internal link annotation${linkCount !== 1 ? "s" : ""}.`,
        file: ctx.pdfPath,
      },
    ];
  },
};

registerCheck(check);
export default check;
