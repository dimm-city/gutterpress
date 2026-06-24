import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getOpPass } from "../../lib/pdf-inspect";

const check: Check = {
  id: "heuristic.decoration.layer-count",
  name: "Layer Count",
  description: "Counts image objects per page",
  category: "heuristic",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const maxLayers = ctx.config.validate.heuristics.maxDecorativeLayers;
    if (!maxLayers) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    const { imagesByPage } = await getOpPass(doc);
    const heavyPages: number[] = [];
    for (const [page, imgs] of imagesByPage) {
      if (imgs.length > maxLayers) heavyPages.push(page);
    }

    if (heavyPages.length > 0) {
      heavyPages.sort((a, b) => a - b);
      return [
        {
          checkId: check.id,
          severity: "info",
          message: `Pages with many image layers (>${maxLayers}): ${heavyPages.join(", ")}`,
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
