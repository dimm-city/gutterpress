import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { inspectPdf } from "../../engine/shared/pdf-inspect";

const check: Check = {
  id: "pdf.print.bleed",
  name: "Bleed Box",
  description:
    "Compares each page's TrimBox with its BleedBox (else the sheet): the bleed is needed on the top, bottom and outside edge",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    // pdf-lib reads every page's boxes, also from page dictionaries packed
    // into object streams, which a raw-byte scan cannot see.
    const facts = await readFile(ctx.pdfPath)
      .then((bytes) => inspectPdf(bytes))
      .catch(() => null);
    if (!facts) {
      return [
        inspectionFailed(check.id, "Could not inspect PDF for bleed boxes.", {
          file: ctx.pdfPath,
        }),
      ];
    }

    if (facts.boxes.every((b) => !b.trim && !b.bleed)) {
      return [
        finding(check.id, {
          severity: "warning",
          message:
            "No TrimBox or BleedBox found. Bleed area cannot be verified.",
          file: ctx.pdfPath,
        }),
      ];
    }

    // The three-edge model (shared/print-area.ts): the top, bottom and OUTER
    // edge need the bleed — the right of a recto (odd page), the left of a
    // verso — and the binding edge none. A CSS `@page { bleed }` sheet has it
    // on every side, which passes too. The bleed is what lies between the
    // TrimBox and the BleedBox (the sheet less any slug for the marks); a page
    // with no BleedBox is measured to its sheet, and one with no TrimBox has
    // declared no trim at all. The page-size tolerance absorbs rounding.
    const bleedSize = ctx.config.validate.pdf.bleedSize;
    const need = bleedSize - ctx.config.page.tolerance;
    const short: number[] = [];
    let undeclared = 0;
    facts.boxes.forEach(({ media, bleed, trim }, i) => {
      const outer = bleed && bleed.length === 4 ? bleed : media;
      if (!trim || trim.length < 4 || outer.length < 4) {
        undeclared++;
        short.push(i + 1);
        return;
      }
      const [ox0, oy0, ox1, oy1] = outer as [number, number, number, number];
      const [tx0, ty0, tx1, ty1] = trim as [number, number, number, number];
      const outside = i % 2 === 0 ? ox1 - tx1 : tx0 - ox0;
      if (outside < need || ty0 - oy0 < need || oy1 - ty1 < need) short.push(i + 1);
    });

    if (short.length > 0) {
      const pages = short.length > 10 ? `${short.slice(0, 10).join(", ")}, …` : short.join(", ");
      const missing = undeclared > 0 ? ` ${undeclared} of them declare no TrimBox.` : "";
      return [
        finding(check.id, {
          severity: "warning",
          message:
            `Bleed area appears insufficient on ${short.length} page(s) (${pages}). ` +
            `Expected at least ${bleedSize}pt on the top, bottom and outside edge.${missing}`,
          file: ctx.pdfPath,
        }),
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
