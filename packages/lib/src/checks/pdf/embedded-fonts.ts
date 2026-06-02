import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { loadPdf, getOpPass } from "../../lib/pdf-inspect";

const check: Check = {
  id: "pdf.print.embedded-fonts",
  name: "Embedded Fonts",
  description: "Verifies all fonts in the PDF are embedded",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) return [];

    const { fonts } = await getOpPass(doc);

    if (fonts.length === 0) {
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "No fonts detected (unexpected).",
          file: ctx.pdfPath,
        },
      ];
    }

    const notEmbedded = fonts.filter((f) => !f.embedded);
    if (notEmbedded.length > 0) {
      return [
        {
          checkId: check.id,
          severity: "error",
          message: `Not all fonts are embedded (${notEmbedded
            .map((f) => f.name)
            .join(", ")}). Check @font-face and Chromium output.`,
          file: ctx.pdfPath,
        },
      ];
    }

    return [];
  },
};

registerCheck(check);
export default check;
