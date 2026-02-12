import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";
import {
  parsePdfInfoBox,
  parsePdfImages,
  filterRasterized,
} from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.rasterized-pages",
  name: "Rasterized Pages",
  description:
    "Detects pages that appear to be fully rasterized (CSS filters, blend modes, transparency)",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["pdfinfo", "pdfimages", "pdftotext"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const info = await execCapture("pdfinfo", ["-box", ctx.pdfPath]);
    const size = parsePdfInfoBox(info.stdout);
    if (!size) return [];

    const images = await execCapture("pdfimages", ["-list", ctx.pdfPath]);
    const candidates = parsePdfImages(images.stdout, size);
    const rasterizedPages = await filterRasterized(
      candidates,
      ctx.pdfPath,
      images.stdout
    );

    if (rasterizedPages.length === 0) return [];

    return [
      {
        checkId: check.id,
        severity: "warning",
        message: `Possible rasterized pages detected: ${rasterizedPages.join(", ")}`,
        file: ctx.pdfPath,
      },
      {
        checkId: check.id,
        severity: "warning",
        message:
          "This may indicate CSS filters, blend modes, or transparency that forced flattening.",
      },
      {
        checkId: check.id,
        severity: "warning",
        message:
          "Text on these pages may not be selectable and quality may be reduced.",
      },
    ];
  },
};

registerCheck(check);
export default check;
