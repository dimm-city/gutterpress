import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getImageResolutions } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.print.image-resolution",
  name: "Image Resolution",
  description: "Checks DPI of images embedded in the PDF",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const minDpi = ctx.config.validate.pdf.minImageResolution;
    if (!minDpi) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    // Effective DPI is derived from pixel size ÷ placed size (best-effort; see
    // ADR 0002). Round to tolerate sub-pixel placement noise near the threshold.
    const resolutions = await getImageResolutions(doc);
    const lowResPages: number[] = [];
    for (const r of resolutions) {
      if (Math.round(r.xDpi) < minDpi || Math.round(r.yDpi) < minDpi) {
        if (!lowResPages.includes(r.page)) lowResPages.push(r.page);
      }
    }

    if (lowResPages.length > 0) {
      lowResPages.sort((a, b) => a - b);
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: `Low-resolution images (below ${minDpi} DPI) found on pages: ${lowResPages.join(", ")}`,
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
