import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "pdf.print.image-resolution",
  name: "Image Resolution",
  description: "Checks DPI of images embedded in the PDF",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["pdfimages"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const minDpi = ctx.config.validate.pdf.minImageResolution;
    if (!minDpi) return [];

    try {
      const { stdout } = await execCapture("pdfimages", [
        "-list",
        ctx.pdfPath,
      ]);
      const lines = stdout
        .split(/\r?\n/)
        .filter((l) => /^\s*\d+\s+\d+/.test(l));

      const lowResPages: number[] = [];

      for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        const pageNum = parseInt(cols[0]!, 10);
        const xppi = parseInt(cols[12]!, 10);
        const yppi = parseInt(cols[13]!, 10);

        if (isNaN(xppi) || isNaN(yppi)) continue;
        if (xppi > 0 && yppi > 0 && (xppi < minDpi || yppi < minDpi)) {
          if (!lowResPages.includes(pageNum)) {
            lowResPages.push(pageNum);
          }
        }
      }

      if (lowResPages.length > 0) {
        return [
          {
            checkId: check.id,
            severity: "warning",
            message: `Low-resolution images (below ${minDpi} DPI) found on pages: ${lowResPages.join(", ")}`,
            file: ctx.pdfPath,
          },
        ];
      }
    } catch {
      // pdfimages not available or failed
    }

    return [];
  },
};

registerCheck(check);
export default check;
