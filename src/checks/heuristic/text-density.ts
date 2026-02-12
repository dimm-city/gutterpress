import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "heuristic.whitespace.text-density",
  name: "Text Density",
  description: "Checks characters-per-page ratio via pdftotext",
  category: "heuristic",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const range = ctx.config.validate.heuristics.textDensityRange;
    if (!range.min && !range.max) return [];

    try {
      // Get total page count
      const { stdout: infoOut } = await execCapture("pdfinfo", [
        ctx.pdfPath,
      ]);
      const pagesMatch = infoOut.match(/Pages:\s+(\d+)/);
      if (!pagesMatch) return [];
      const totalPages = parseInt(pagesMatch[1]!, 10);

      const results: CheckResult[] = [];
      const lowPages: number[] = [];
      const highPages: number[] = [];

      for (let page = 1; page <= totalPages; page++) {
        try {
          const { stdout } = await execCapture("pdftotext", [
            "-f",
            String(page),
            "-l",
            String(page),
            ctx.pdfPath,
            "-",
          ]);
          const charCount = stdout.replace(/\s/g, "").length;

          if (range.min && charCount > 0 && charCount < range.min) {
            lowPages.push(page);
          }
          if (range.max && charCount > range.max) {
            highPages.push(page);
          }
        } catch {
          // Skip this page
        }
      }

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
    } catch {
      return [];
    }
  },
};

registerCheck(check);
export default check;
