import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.nav.toc-links",
  name: "TOC Links",
  description: "Detects link annotations on TOC pages",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.requireTocLinks) return [];

    try {
      const { stdout } = await execCapture("qpdf", [
        "--list-all-objects",
        ctx.pdfPath,
      ]);
      const hasLinks = /\/Type\s+\/Annot[\s\S]*?\/Subtype\s+\/Link/.test(
        stdout
      );
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
    } catch {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "Could not inspect PDF for TOC links.",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
