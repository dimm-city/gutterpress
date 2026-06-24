import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import {
  loadPdf,
  getOpPass,
  getTextPass,
  getPageSize,
} from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.print.rasterized-pages",
  name: "Rasterized Pages",
  description:
    "Detects pages that appear to be fully rasterized (CSS filters, blend modes, transparency)",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    const { imagesByPage } = await getOpPass(doc);
    const { textByPage } = await getTextPass(doc);

    const rasterizedPages: number[] = [];

    for (const [pageNum, imgs] of imagesByPage) {
      // A rasterized page is a single full-page image with little real text.
      if (imgs.length !== 1) continue;

      let page;
      try {
        page = await doc.getPage(pageNum);
      } catch {
        continue;
      }
      const { w: pageW, h: pageH } = getPageSize(page);
      const img = imgs[0]!;
      const widthMatch = Math.abs(img.placedW - pageW) / pageW < 0.03;
      const heightMatch = Math.abs(img.placedH - pageH) / pageH < 0.03;
      if (!widthMatch || !heightMatch) continue;

      // Some text but mostly image (20–200 non-whitespace chars) ⇒ likely a
      // flattened/rasterized page rather than intentional full-bleed artwork.
      const text = (textByPage[pageNum - 1] ?? "").replace(/\s+/g, "");
      if (text.length > 20 && text.length < 200) {
        rasterizedPages.push(pageNum);
      }
    }

    if (rasterizedPages.length === 0) return [];
    rasterizedPages.sort((a, b) => a - b);

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
