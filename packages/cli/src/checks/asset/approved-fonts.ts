import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { FONT_EXTS } from "./extensions";

const check: Check = {
  id: "asset.font.approved-files",
  name: "Approved Font Files",
  description: "Checks font files against the approved file patterns",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const patterns = ctx.config.validate.assets.approvedFontFiles;
    if (!patterns || patterns.length === 0) return [];

    const { glob } = await import("glob");
    const dirs = ctx.assetDirs ?? [ctx.inputDir];

    // Collect all font files
    const allFonts: string[] = [];
    for (const dir of dirs) {
      const matches = await glob(`**/*.{${FONT_EXTS.join(",")}}`, {
        cwd: dir,
        absolute: true,
      });
      allFonts.push(...matches);
    }

    if (allFonts.length === 0) return [];

    // Collect approved font files
    const approvedFonts = new Set<string>();
    for (const dir of dirs) {
      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          cwd: dir,
          absolute: true,
        });
        for (const m of matches) approvedFonts.add(m);
      }
    }

    const results: CheckResult[] = [];
    for (const font of allFonts) {
      if (!approvedFonts.has(font)) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: "Font file not in approved list",
          file: font,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
