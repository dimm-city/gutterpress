import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { readPdfBytes } from "../../lib/pdf-parse";

/** Extract the first `/Box [x0 y0 x1 y1]` array from raw PDF bytes. */
function findBox(
  bytes: string,
  box: "MediaBox" | "TrimBox" | "BleedBox"
): [number, number, number, number] | null {
  const re = new RegExp(
    `/${box}\\s*\\[\\s*(-?[0-9.]+)\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)\\s*\\]`
  );
  const m = bytes.match(re);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

const check: Check = {
  id: "pdf.print.bleed",
  name: "Bleed Box",
  description: "Compares MediaBox vs TrimBox/BleedBox to verify bleed area",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.requireBleed) return [];

    // pdfjs exposes no TrimBox/BleedBox accessor, so read the page boxes from
    // the raw (uncompressed) page dictionaries. Chromium writes these
    // uncompressed; markers inside object streams would be missed (rare).
    const bytes = await readPdfBytes(ctx.pdfPath).catch(() => "");
    if (!bytes) {
      return [
        inspectionFailed(check.id, "Could not inspect PDF for bleed boxes.", {
          file: ctx.pdfPath,
        }),
      ];
    }

    const media = findBox(bytes, "MediaBox");
    const trim = findBox(bytes, "TrimBox");
    const bleed = findBox(bytes, "BleedBox");

    if (!media) {
      return [
        inspectionFailed(check.id, "Could not parse MediaBox from PDF.", {
          file: ctx.pdfPath,
        }),
      ];
    }

    if (!trim && !bleed) {
      return [
        finding(check.id, {
          severity: "warning",
          message:
            "No TrimBox or BleedBox found. Bleed area cannot be verified.",
          file: ctx.pdfPath,
        }),
      ];
    }

    if (trim) {
      const mediaW = media[2] - media[0];
      const trimW = trim[2] - trim[0];
      const bleedSize = ctx.config.validate.pdf.bleedSize;
      if (mediaW - trimW < bleedSize * 2 * 0.9) {
        return [
          finding(check.id, {
            severity: "warning",
            message: `Bleed area appears insufficient. Expected at least ${bleedSize}pt on each side.`,
            file: ctx.pdfPath,
          }),
        ];
      }
    }

    return [];
  },
};

registerCheck(check);
export default check;
