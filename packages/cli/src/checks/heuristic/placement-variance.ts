import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getTextPass } from "../../lib/pdf-inspect";

const check: Check = {
  id: "heuristic.layout.placement-variance",
  name: "Placement Variance",
  description: "Analyzes text baseline coordinates for layout consistency",
  category: "heuristic",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    const { positions } = await getTextPass(doc);
    if (positions.length < 2) return [];

    const uniqueX = new Set(positions.map((p) => Math.round(p.x)));

    return [
      {
        checkId: check.id,
        severity: "info",
        message: `Layout analysis: ${uniqueX.size} unique horizontal text positions across ${positions.length} text blocks.`,
        file: ctx.pdfPath,
      },
    ];
  },
};

registerCheck(check);
export default check;
