import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";
import { parsePdfInfoBox } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.page-size",
  name: "Page Size",
  description: "Validates PDF page dimensions match expected size from config",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["pdfinfo"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const info = await execCapture("pdfinfo", ["-box", ctx.pdfPath]);
    const size = parsePdfInfoBox(info.stdout);

    if (!size) {
      return [
        {
          checkId: check.id,
          severity: "error",
          message: "Could not parse PDF page size.",
          file: ctx.pdfPath,
        },
      ];
    }

    const { width, height, tolerance } = ctx.config.page;
    if (
      Math.abs(size.w - width) >= tolerance ||
      Math.abs(size.h - height) >= tolerance
    ) {
      return [
        {
          checkId: check.id,
          severity: "error",
          message: `Page size mismatch: expected ~${width}x${height} pts, got ${size.w}x${size.h} pts.`,
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
