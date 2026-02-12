import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "heuristic.decoration.layer-count",
  name: "Layer Count",
  description: "Counts image objects per page from pdfimages output",
  category: "heuristic",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const maxLayers = ctx.config.validate.heuristics.maxDecorativeLayers;
    if (!maxLayers) return [];

    try {
      const { stdout } = await execCapture("pdfimages", [
        "-list",
        ctx.pdfPath,
      ]);

      const lines = stdout
        .split(/\r?\n/)
        .filter((l) => /^\s*\d+\s+\d+/.test(l));

      // Count images per page
      const imagesPerPage = new Map<number, number>();
      for (const line of lines) {
        const pageNum = parseInt(line.trim().split(/\s+/)[0]!, 10);
        if (!isNaN(pageNum)) {
          imagesPerPage.set(
            pageNum,
            (imagesPerPage.get(pageNum) || 0) + 1
          );
        }
      }

      const results: CheckResult[] = [];
      const heavyPages: number[] = [];

      for (const [page, count] of imagesPerPage) {
        if (count > maxLayers) {
          heavyPages.push(page);
        }
      }

      if (heavyPages.length > 0) {
        results.push({
          checkId: check.id,
          severity: "info",
          message: `Pages with many image layers (>${maxLayers}): ${heavyPages.join(", ")}`,
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
