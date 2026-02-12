import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.print.bleed",
  name: "Bleed Box",
  description:
    "Compares MediaBox vs TrimBox/BleedBox to verify bleed area",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    if (!ctx.config.validate.pdf.requireBleed) return [];

    try {
      const { stdout } = await execCapture("pdfinfo", [
        "-box",
        ctx.pdfPath,
      ]);

      const mediaMatch = stdout.match(
        /MediaBox:\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/
      );
      const trimMatch = stdout.match(
        /TrimBox:\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/
      );
      const bleedMatch = stdout.match(
        /BleedBox:\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/
      );

      if (!mediaMatch) {
        return [
          {
            checkId: check.id,
            severity: "warning",
            message: "Could not parse MediaBox from PDF.",
            file: ctx.pdfPath,
          },
        ];
      }

      if (!trimMatch && !bleedMatch) {
        return [
          {
            checkId: check.id,
            severity: "warning",
            message:
              "No TrimBox or BleedBox found. Bleed area cannot be verified.",
            file: ctx.pdfPath,
          },
        ];
      }

      // Check that bleed extends beyond trim
      if (trimMatch && mediaMatch) {
        const mediaW =
          parseFloat(mediaMatch[3]!) - parseFloat(mediaMatch[1]!);
        const trimW =
          parseFloat(trimMatch[3]!) - parseFloat(trimMatch[1]!);
        const bleedSize = ctx.config.validate.pdf.bleedSize;

        if (mediaW - trimW < bleedSize * 2 * 0.9) {
          return [
            {
              checkId: check.id,
              severity: "warning",
              message: `Bleed area appears insufficient. Expected at least ${bleedSize}pt on each side.`,
              file: ctx.pdfPath,
            },
          ];
        }
      }
    } catch {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "Could not inspect PDF for bleed boxes.",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
