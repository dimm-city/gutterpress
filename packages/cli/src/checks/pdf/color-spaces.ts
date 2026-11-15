import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectionFailed } from "../policy";
import { findPdfMarkers } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.color-spaces",
  name: "Color Spaces",
  description:
    "Checks for forbidden color spaces (DeviceRGB, Lab, Separation, DeviceN)",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    // Raw byte scan. /Lab uses a \b boundary so the "/Label" key and similar
    // do not false-positive as the Lab color space.
    let found;
    try {
      found = await findPdfMarkers(ctx.pdfPath, {
        rgb: /\/DeviceRGB/,
        lab: /\/Lab\b/,
        separation: /\/Separation/,
        deviceN: /\/DeviceN/,
      });
    } catch {
      return [inspectionFailed(check.id, "Could not read the PDF to scan its color spaces.", { file: ctx.pdfPath })];
    }

    const results: CheckResult[] = [];

    if (found.has("rgb")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message:
          "DeviceRGB found (interior must be CMYK or grayscale only).",
        file: ctx.pdfPath,
      });
    }
    if (found.has("lab")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Lab color space found (not allowed).",
        file: ctx.pdfPath,
      });
    }
    if (found.has("separation")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Spot color (Separation) found (DriveThruRPG accepts process CMYK only; PDF/X-1a itself permits spot colors).",
        file: ctx.pdfPath,
      });
    }
    if (found.has("deviceN")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Spot color (DeviceN) found (DriveThruRPG accepts process CMYK only; PDF/X-1a itself permits spot colors).",
        file: ctx.pdfPath,
      });
    }

    return results;
  },
};

registerCheck(check);
export default check;
