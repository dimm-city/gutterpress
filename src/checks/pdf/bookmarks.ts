import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.nav.bookmarks",
  name: "Bookmarks",
  description: "Checks for PDF outline (bookmarks) tree",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["qpdf"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.requireBookmarks) return [];

    try {
      const { stdout } = await execCapture("qpdf", [
        "--list-all-objects",
        ctx.pdfPath,
      ]);
      const hasOutlines = /\/Type\s+\/Outlines/.test(stdout);
      if (!hasOutlines) {
        return [
          {
            checkId: check.id,
            severity: "warning",
            message: "PDF does not contain bookmarks (outline tree).",
            file: ctx.pdfPath,
          },
        ];
      }
    } catch {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "Could not inspect PDF for bookmarks.",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
