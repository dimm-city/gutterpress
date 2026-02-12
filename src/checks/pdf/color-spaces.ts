import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.print.color-spaces",
  name: "Color Spaces",
  description:
    "Checks for forbidden color spaces (DeviceRGB, Lab, Separation, DeviceN)",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["grep"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const colorCheck = await execCapture("grep", [
      "-ao",
      "/DeviceRGB\\|/Lab\\b\\|/Separation\\|/DeviceN",
      ctx.pdfPath,
    ]).catch(() => ({ stdout: "", stderr: "" }));

    const results: CheckResult[] = [];

    if (colorCheck.stdout.includes("/DeviceRGB")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message:
          "DeviceRGB found (interior must be CMYK or grayscale only).",
        file: ctx.pdfPath,
      });
    }
    if (colorCheck.stdout.includes("/Lab")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Lab color space found (not allowed).",
        file: ctx.pdfPath,
      });
    }
    if (colorCheck.stdout.includes("/Separation")) {
      results.push({
        checkId: check.id,
        severity: "error",
        message: "Spot color (Separation) found (not allowed).",
        file: ctx.pdfPath,
      });
    }
    if (colorCheck.stdout.includes("/DeviceN")) {
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
