import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "asset.image.resolution",
  name: "Image Resolution",
  description: "Checks source image DPI using ImageMagick identify",
  category: "asset",
  phase: "pre-build",
  requiredTools: ["identify"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const minDpi = ctx.config.validate.assets.minImageDpi;
    if (!minDpi) return [];

    const files = await collectImageFiles(ctx);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const { stdout } = await execCapture("identify", [
          "-format",
          "%w %h %x %y",
          file,
        ]);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 4) {
          const xDpi = parseFloat(parts[2]!);
          const yDpi = parseFloat(parts[3]!);

          if (
            !isNaN(xDpi) &&
            !isNaN(yDpi) &&
            xDpi > 0 &&
            yDpi > 0 &&
            (xDpi < minDpi || yDpi < minDpi)
          ) {
            results.push({
              checkId: check.id,
              severity: "warning",
              message: `Image resolution too low: ${xDpi}x${yDpi} DPI (minimum ${minDpi} DPI)`,
              file,
            });
          }
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
