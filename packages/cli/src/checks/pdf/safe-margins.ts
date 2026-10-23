import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { getOpPass, loadPdf } from "../../lib/pdf-inspect";
import {
  judgeRect,
  pageBoxes,
  type PageEdge,
  type PageSide,
  type PrintArea,
  type Rect,
} from "../../engine/shared/print-area";

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
/** An image's size for a message: `2.0 x 3.0in`. */
const size = (r: Rect) => `${(r.w / 72).toFixed(1)} x ${(r.h / 72).toFixed(1)}in`;

/**
 * A box in the PDF's coordinates (points, y up from the sheet's bottom) as the
 * page boxes see it: the same points, y down from the sheet's top.
 */
const fromPdf = (x: number, y: number, w: number, h: number, sheetHeight: number): Rect => ({
  x,
  y: sheetHeight - y - h,
  w,
  h,
});

const check: Check = {
  id: "pdf.print.safe-margins",
  name: "Safe margins",
  description:
    "Fails when text sits closer to the trim than `page.safe` (DriveThruRPG: 0.5in on every edge) or an image that does not bleed closer than `page.artSafe` (DriveThruRPG: 0.25in on the top, bottom and outside edges), both held to `page.gutter` at the binding edge where one is set; and when an image crosses the trim without reaching the sheet's edge (it ends in the bleed band). Text and images: filled backgrounds and borders are judged in the preview's safe-area overlay, not here. Skipped when `page.safe` is not set",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const { width, height, bleed = 0, safe = 0, artSafe = safe, gutter = safe } = ctx.config.page;
    if (!ctx.pdfPath || !safe) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [inspectionFailed(check.id, "Could not parse the PDF's text and image positions.", { file: ctx.pdfPath })];
    }

    const area: PrintArea = { width, height, bleed, safe, artSafe, gutter };
    const rule = ctx.config.spec?.label ?? "page.safe";
    const textRule =
      gutter === safe
        ? `${rule}: text must stay at least ${inches(safe)} inside the trim on every edge.`
        : `${rule}: text must stay at least ${inches(safe)} inside the trim, ${inches(gutter)} at the binding.`;
    const artRule =
      gutter === artSafe
        ? `${rule}: art that does not bleed must stay at least ${inches(artSafe)} inside the trim on every edge.`
        : `${rule}: art that does not bleed must stay at least ${inches(artSafe)} inside the trim, ${inches(gutter)} at the binding.`;
    const results: CheckResult[] = [];
    try {
      const { imagesByPage } = await getOpPass(doc);
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        // Page 1 is a recto: binding on the left, outside on the right, and a
        // verso mirrors that. The boxes put the bleed on the top, bottom and
        // outside edges only, so the trim is the sheet less the bleed there.
        const side: PageSide = pageNum % 2 === 1 ? "recto" : "verso";
        const boxes = pageBoxes(area, side);
        const binding: PageEdge = side === "recto" ? "left" : "right";
        const edgeName = (edge: PageEdge): string =>
          edge === "top" || edge === "bottom" ? edge : edge === binding ? "binding" : "outside";

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
          const x0 = Math.min(...xs);
          const y0 = Math.min(...ys);
          const box = fromPdf(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0, height);

          const { kind, edge, gap, need } = judgeRect(box, boxes, "text", TOLERANCE_PT);
          if (kind === "inside") continue;
          // how far the worst edge falls short of the rule: `gutter` at the binding, `safe` elsewhere
          const shortfall = need - gap;
          const text = item.str.trim();
          results.push(
            finding(check.id, {
              severity: "error",
              message: `Page ${pageNum}: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}" is ${inches(shortfall)} too close to the ${edgeName(edge!)} edge.`,
              file: ctx.pdfPath,
              detail: textRule,
              code: "text-outside-safe-margin",
              data: { page: pageNum, edge: edgeName(edge!), shortfallPt: +shortfall.toFixed(2) },
            })
          );
        }

        for (const image of imagesByPage.get(pageNum) ?? []) {
          const { x, y, w, h } = image.bounds;
          const box = fromPdf(x, y, w, h, height);
          const { kind, edge, gap, need } = judgeRect(box, boxes, "art", TOLERANCE_PT);
          if (kind === "inside") continue;
          const name = edgeName(edge!);
          if (kind === "bleed") {
            // Past the trim but short of the sheet's edge: the cut lands in the
            // picture or just beyond it. The shortfall is to the sheet's edge.
            const short = boxes.bleed + gap;
            results.push(
              finding(check.id, {
                severity: "error",
                message: `Page ${pageNum}: a ${size(box)} image ends in the bleed band on the ${name} edge, ${inches(short)} short of the sheet's edge.`,
                file: ctx.pdfPath,
                detail: `${rule}: art either stays ${inches(artSafe)} inside the trim or bleeds, running past it to the sheet's edge; art that stops between the two can leave a white sliver when the page is cut.`,
                code: "art-ends-in-bleed-band",
                data: { page: pageNum, edge: name, shortfallPt: +short.toFixed(2) },
              })
            );
            continue;
          }
          const shortfall = need - gap;
          results.push(
            finding(check.id, {
              severity: "error",
              message: `Page ${pageNum}: a ${size(box)} image is ${inches(shortfall)} too close to the ${name} edge.`,
              file: ctx.pdfPath,
              detail: artRule,
              code: "art-outside-safe-margin",
              data: { page: pageNum, edge: name, shortfallPt: +shortfall.toFixed(2) },
            })
          );
        }
      }
    } catch {
      return [inspectionFailed(check.id, "Could not read the PDF's text and image positions.", { file: ctx.pdfPath })];
    }
    return results;
  },
};

registerCheck(check);
export default check;
