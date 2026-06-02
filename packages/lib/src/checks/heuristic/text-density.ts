import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getTextPass } from "../../lib/pdf-inspect";

const check: Check = {
  id: "heuristic.whitespace.text-density",
  name: "Text Density",
  description: "Checks characters-per-page ratio",
  category: "heuristic",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const range = ctx.config.validate.heuristics.textDensityRange;
    if (!range.min && !range.max) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    const { textByPage } = await getTextPass(doc);
    const results: CheckResult[] = [];
    const lowPages: number[] = [];
    const highPages: number[] = [];

    textByPage.forEach((text, idx) => {
      const page = idx + 1;
      const charCount = text.replace(/\s/g, "").length;
      if (range.min && charCount > 0 && charCount < range.min) lowPages.push(page);
      if (range.max && charCount > range.max) highPages.push(page);
    });

    if (lowPages.length > 0) {
      results.push({
        checkId: check.id,
        severity: "info",
        message: `Low text density on pages: ${lowPages.join(", ")} (below ${range.min} chars)`,
        file: ctx.pdfPath,
      });
    }

    if (highPages.length > 0) {
      results.push({
        checkId: check.id,
        severity: "info",
        message: `High text density on pages: ${highPages.join(", ")} (above ${range.max} chars)`,
        file: ctx.pdfPath,
      });
    }

    return results;
  },
};

registerCheck(check);
export default check;
