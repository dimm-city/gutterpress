import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { getPerPageInkCoverage } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.ink-coverage",
  name: "Ink Coverage (TAC)",
  description:
    "Checks total area coverage (TAC) against maximum ink limits",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["gs"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const pages = await getPerPageInkCoverage(ctx.pdfPath);
    const limit = ctx.config.ink.maxTac + ctx.config.ink.tacTolerance;
    const offending = pages
      .filter((p) => p.tac > limit)
      .sort((a, b) => b.tac - a.tac);

    if (offending.length === 0) return [];

    const maxTac = offending[0]!.tac;
    const results: CheckResult[] = [
      {
        checkId: check.id,
        severity: "warning",
        message: `Total ink coverage too high on ${offending.length} page(s) (max ${maxTac.toFixed(1)}%, recommended <=${ctx.config.ink.maxTac}%)`,
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

    for (const page of offending.slice(0, 5)) {
      results.push({
        checkId: check.id,
        severity: "warning",
        message: `  Page ${page.page}: C:${page.c.toFixed(1)}% M:${page.m.toFixed(1)}% Y:${page.y.toFixed(1)}% K:${page.k.toFixed(1)}% = ${page.tac.toFixed(1)}% TAC`,
        file: ctx.pdfPath,
      });
    }

    if (offending.length > 5) {
      results.push({
        checkId: check.id,
        severity: "warning",
        message: `  ...and ${offending.length - 5} more page(s) over ${ctx.config.ink.maxTac}% TAC`,
        file: ctx.pdfPath,
      });
    }

    return results;
  },
};

registerCheck(check);
export default check;
