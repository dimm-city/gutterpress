import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { parseCmykFromPdf } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.ink-coverage",
  name: "Ink Coverage (TAC)",
  description:
    "Checks total area coverage (TAC) against maximum ink limits",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["qpdf", "strings"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const cmykData = await parseCmykFromPdf(ctx.pdfPath);
    const maxTac = cmykData.maxTac;
    const limit = ctx.config.ink.maxTac + ctx.config.ink.tacTolerance;

    if (maxTac <= limit) return [];

    const results: CheckResult[] = [
      {
        checkId: check.id,
        severity: "warning",
        message: `Total ink coverage too high (max ${maxTac.toFixed(1)}%, recommended <=${ctx.config.ink.maxTac}%)`,
        file: ctx.pdfPath,
      },
      {
        checkId: check.id,
        severity: "warning",
        message:
          "Some pages may have issues with commercial print. Consider lightening dark backgrounds.",
        file: ctx.pdfPath,
      },
    ];

    if (cmykData.colors.length > 0) {
      const offending = cmykData.colors
        .slice(0, 3)
        .filter((c) => c.tac > ctx.config.ink.maxTac);
      for (const color of offending) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: `  C:${color.c.toFixed(1)}% M:${color.m.toFixed(1)}% Y:${color.y.toFixed(1)}% K:${color.k.toFixed(1)}% = ${color.tac.toFixed(1)}% TAC`,
          file: ctx.pdfPath,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
