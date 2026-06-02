import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, countLinkAnnotations } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.nav.toc-links",
  name: "TOC Links",
  description: "Detects link annotations on TOC pages",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.requireTocLinks) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "Could not inspect PDF for TOC links.",
          file: ctx.pdfPath,
        },
      ];
    }

    const hasLinks = (await countLinkAnnotations(doc, true)) > 0;
    if (!hasLinks) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "No link annotations found in PDF (expected for TOC).",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
