import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { inspectPdf } from "../../engine/shared/pdf-inspect";

const check: Check = {
  id: "pdf.print.bleed",
  name: "Bleed Box",
  description:
    "Compares each page's MediaBox with its TrimBox: the bleed is needed on the top, bottom and outside edge",
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
    // on every side, which passes too.
    const bleedSize = ctx.config.validate.pdf.bleedSize;
    const need = bleedSize * 0.9;
    const short: number[] = [];
    facts.boxes.forEach(({ media, trim }, i) => {
      if (!trim || media.length < 4 || trim.length < 4) return;
      const [mx0, my0, mx1, my1] = media as [number, number, number, number];
      const [tx0, ty0, tx1, ty1] = trim as [number, number, number, number];
      const outer = i % 2 === 0 ? mx1 - tx1 : tx0 - mx0;
      if (outer < need || ty0 - my0 < need || my1 - ty1 < need) short.push(i + 1);
    });

    if (short.length > 0) {
      const pages = short.length > 10 ? `${short.slice(0, 10).join(", ")}, …` : short.join(", ");
      return [
        finding(check.id, {
          severity: "warning",
          message: `Bleed area appears insufficient on ${short.length} page(s) (${pages}). Expected at least ${bleedSize}pt on the top, bottom and outside edge.`,
          file: ctx.pdfPath,
        }),
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
