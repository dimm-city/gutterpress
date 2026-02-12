import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "asset.image.color-space",
  name: "Image Color Space",
  description: "Validates image color spaces against allowed list",
  category: "asset",
  phase: "pre-build",
  requiredTools: ["identify"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const allowed = ctx.config.validate.assets.allowedColorSpaces;
    if (!allowed || allowed.length === 0) return [];

    const files = await collectImageFiles(ctx);
    if (files.length === 0) return [];

    const allowedLower = new Set(allowed.map((s) => s.toLowerCase()));
    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const { stdout } = await execCapture("identify", [
          "-format",
          "%[colorspace]",
          file,
        ]);
        const colorspace = stdout.trim().toLowerCase();

        if (colorspace && !allowedLower.has(colorspace)) {
          results.push({
            checkId: check.id,
            severity: "warning",
            message: `Image uses ${stdout.trim()} color space (allowed: ${allowed.join(", ")})`,
            file,
          });
        }
      } catch {
        // identify not available or file not recognized
      }
    }

    return results;
  },
};

async function collectImageFiles(ctx: CheckContext): Promise<string[]> {
  const { glob } = await import("glob");
  const dirs = ctx.assetDirs ?? [ctx.inputDir];
  const files: string[] = [];

  for (const dir of dirs) {
    const matches = await glob("**/*.{png,jpg,jpeg,tiff,tif}", {
      cwd: dir,
      absolute: true,
    });
    files.push(...matches);
  }

  return files;
}

registerCheck(check);
export default check;
