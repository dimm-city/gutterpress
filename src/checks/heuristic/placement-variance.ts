import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "heuristic.layout.placement-variance",
  name: "Placement Variance",
  description: "Analyzes PDF content stream coordinates for layout consistency",
  category: "heuristic",
  phase: "post-build",
  requiredTools: ["qpdf"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    try {
      const { stdout } = await execCapture("qpdf", [
        "--list-all-objects",
        ctx.pdfPath,
      ]);

      // Extract Tm (text matrix) operations for coordinate analysis
      const tmPattern = /(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+Tm/g;
      const positions: Array<{ x: number; y: number }> = [];
      let match;

      while ((match = tmPattern.exec(stdout)) !== null) {
        const x = parseFloat(match[3]!);
        const y = parseFloat(match[4]!);
        if (!isNaN(x) && !isNaN(y)) {
          positions.push({ x, y });
        }
      }

      if (positions.length < 2) return [];

      // Calculate variance of x positions (text alignment consistency)
      const xValues = positions.map((p) => p.x);
      const uniqueX = new Set(xValues.map((x) => Math.round(x)));

      return [
        {
          checkId: check.id,
          severity: "info",
          message: `Layout analysis: ${uniqueX.size} unique horizontal text positions across ${positions.length} text blocks.`,
          file: ctx.pdfPath,
        },
      ];
    } catch {
      return [];
    }
  },
};

registerCheck(check);
export default check;
