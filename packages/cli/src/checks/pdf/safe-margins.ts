import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { loadPdf } from "../../lib/pdf-inspect";

/** Rounding slack in the PDF's coordinates, in points. */
const TOLERANCE_PT = 0.5;

/**
 * pdf.js reports a text item's height as its font size and nothing dependable
 * about where the baseline sits in it (the ascent it reads from an embedded font
 * is missing for some fonts and 1 em or more for others), so a glyph box is that
 * em split the way pdf.js's own text layer falls back to: 0.8 above the
 * baseline, 0.2 below. The full em above the baseline would overshoot the ink by
 * about a quarter em and flag a heading set flush on the limit.
 */
const ABOVE_BASELINE = 0.8;
const BELOW_BASELINE = 0.2;

const inches = (pt: number) => `${+(pt / 72).toFixed(2)}in`;

const check: Check = {
  id: "pdf.print.safe-margins",
  name: "Safe margins",
  description:
    "Fails when text sits closer to the trim than `page.safe` (DriveThruRPG: 0.5in on every edge). Text only: art is judged in the preview's safe-area overlay, not here. Skipped when `page.safe` is not set",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const { width, height, bleed = 0, safe = 0 } = ctx.config.page;
    if (!ctx.pdfPath || !safe) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [inspectionFailed(check.id, "Could not parse the PDF's text positions.", { file: ctx.pdfPath })];
    }

    const rule = ctx.config.spec?.label ?? "page.safe";
    const results: CheckResult[] = [];
    try {
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        // Page 1 is a recto: binding on the left, outside on the right, and a
        // verso mirrors that. The bleed is on the top, bottom and outside edges
        // only, so the trim is the sheet less the bleed there.
        const recto = pageNum % 2 === 1;
        const trim = {
          left: recto ? 0 : bleed,
          right: width - (recto ? bleed : 0),
          bottom: bleed,
          top: height - bleed,
        };

        const { items } = await (await doc.getPage(pageNum)).getTextContent();
        for (const item of items) {
          if (!("str" in item) || !item.str.trim()) continue;

          // `transform` is [a, b, c, d, e, f], y up from the sheet's bottom:
          // (a, b) runs along the baseline, (c, d) is one em up, (e, f) is the
          // baseline's start; `width` is the advance along (a, b). So the box is
          // the four corners at either end of the advance, below and above the
          // baseline, which also covers rotated and slanted text.
          const [a, b, c, d, e, f] = item.transform as [number, number, number, number, number, number];
          const along = item.width / Math.hypot(a, b);
          const xs: number[] = [];
          const ys: number[] = [];
          for (const s of [0, 1]) {
            for (const u of [-BELOW_BASELINE, ABOVE_BASELINE]) {
              xs.push(e + s * along * a + u * c);
              ys.push(f + s * along * b + u * d);
            }
          }

          // How far each edge of the box sits inside the trim; the least is the worst.
          const gaps = [
            [recto ? "binding" : "outside", Math.min(...xs) - trim.left],
            [recto ? "outside" : "binding", trim.right - Math.max(...xs)],
            ["bottom", Math.min(...ys) - trim.bottom],
            ["top", trim.top - Math.max(...ys)],
          ] as const;
          const [edge, gap] = gaps.reduce((worst, g) => (g[1] < worst[1] ? g : worst));
          const shortfall = safe - gap;
          if (shortfall <= TOLERANCE_PT) continue;

          const text = item.str.trim();
          results.push(
            finding(check.id, {
              severity: "error",
              message: `Page ${pageNum}: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}" is ${inches(shortfall)} too close to the ${edge} edge.`,
              file: ctx.pdfPath,
              detail: `${rule}: text must stay at least ${inches(safe)} inside the trim on every edge.`,
              code: "text-outside-safe-margin",
              data: { page: pageNum, edge, shortfallPt: +shortfall.toFixed(2) },
            })
          );
        }
      }
    } catch {
      return [inspectionFailed(check.id, "Could not read the PDF's text positions.", { file: ctx.pdfPath })];
    }
    return results;
  },
};

registerCheck(check);
export default check;
