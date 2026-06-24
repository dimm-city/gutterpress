import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { readPdfBytes } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.color-spaces",
  name: "Color Spaces",
  description:
    "Checks for forbidden color spaces (DeviceRGB, Lab, Separation, DeviceN)",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    // Raw byte scan — in-process replacement for the previous `grep -ao` usage.
    // Note: /Lab uses a \b boundary (matching the old grep pattern) so the
    // "/Label" key and similar do not false-positive as the Lab color space.
    const bytes = await readPdfBytes(ctx.pdfPath).catch(() => "");

    const results: CheckResult[] = [];

    if (/\/DeviceRGB/.test(bytes)) {
      results.push({
        checkId: check.id,
        severity: "error",
        message:
          "DeviceRGB found (interior must be CMYK or grayscale only).",
        file: ctx.pdfPath,
      });
    }
    if (/\/Lab\b/.test(bytes)) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Lab color space found (not allowed).",
        file: ctx.pdfPath,
      });
    }
    if (/\/Separation/.test(bytes)) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Spot color (Separation) found (not allowed).",
        file: ctx.pdfPath,
      });
    }
    if (/\/DeviceN/.test(bytes)) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Spot color (DeviceN) found (not allowed).",
        file: ctx.pdfPath,
      });
    }

    return results;
  },
};

registerCheck(check);
export default check;
