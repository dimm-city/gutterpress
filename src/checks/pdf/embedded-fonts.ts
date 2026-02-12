import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";
import { parsePdfFonts } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.embedded-fonts",
  name: "Embedded Fonts",
  description: "Verifies all fonts in the PDF are embedded",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const fonts = await execCapture("pdffonts", [ctx.pdfPath]);
    const rows = parsePdfFonts(fonts.stdout);

    if (rows.length === 0) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "No fonts detected (unexpected).",
          file: ctx.pdfPath,
        },
      ];
    }

    if (!rows.every((r) => r.embedded)) {
      return [
        {
          checkId: check.id,
          severity: "error",
          message:
            "Not all fonts are embedded. Check @font-face and Chromium output.",
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
