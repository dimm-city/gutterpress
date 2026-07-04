import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { loadPdf, getPageSize } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.print.page-size",
  name: "Page Size",
  description: "Validates PDF page dimensions match expected size from config",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [
        inspectionFailed(check.id, "Could not parse PDF page size.", {
          file: ctx.pdfPath,
        }),
      ];
    }

    const page = await doc.getPage(1);
    const size = getPageSize(page);

    const { width, height, tolerance } = ctx.config.page;
    if (
      Math.abs(size.w - width) >= tolerance ||
      Math.abs(size.h - height) >= tolerance
    ) {
      return [
        finding(check.id, {
          severity: "error",
          message: `Page size mismatch: expected ~${width}x${height} pts, got ${Math.round(size.w)}x${Math.round(size.h)} pts.`,
          file: ctx.pdfPath,
        }),
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
