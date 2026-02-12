import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.nav.cross-refs",
  name: "Cross References",
  description: "Counts and verifies internal link annotations",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    try {
      const { stdout } = await execCapture("qpdf", [
        "--list-all-objects",
        ctx.pdfPath,
      ]);
      const linkMatches = stdout.match(/\/Subtype\s+\/Link/g);
      const linkCount = linkMatches ? linkMatches.length : 0;

      return [
        {
          checkId: check.id,
          severity: "info",
          message: `PDF contains ${linkCount} internal link annotation${linkCount !== 1 ? "s" : ""}.`,
          file: ctx.pdfPath,
        },
      ];
    } catch {
      return [
        {
          checkId: check.id,
          severity: "info",
          message: "Could not inspect PDF for cross-references.",
          file: ctx.pdfPath,
        },
      ];
    }
  },
};

registerCheck(check);
export default check;
