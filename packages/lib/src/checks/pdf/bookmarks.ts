import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getOutlineCount } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.nav.bookmarks",
  name: "Bookmarks",
  description: "Checks for PDF outline (bookmarks) tree",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.requireBookmarks) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "Could not inspect PDF for bookmarks.",
          file: ctx.pdfPath,
        },
      ];
    }

    if ((await getOutlineCount(doc)) === 0) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "PDF does not contain bookmarks (outline tree).",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
