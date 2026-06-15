import { stat } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

const check: Check = {
  id: "asset.image.file-size",
  name: "Image File Size",
  description: "Checks that image files do not exceed the maximum size limit",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const maxSize = ctx.config.validate.assets.maxImageSize;
    if (!maxSize) return [];

    const files = await collectImageFiles(ctx);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const info = await stat(file);
        if (info.size > maxSize) {
          const sizeMb = (info.size / 1_000_000).toFixed(1);
          const maxMb = (maxSize / 1_000_000).toFixed(1);
          results.push({
            checkId: check.id,
            severity: "warning",
            message: `Image file too large: ${sizeMb}MB (max ${maxMb}MB)`,
            file,
          });
        }
      } catch {
        // File stat error, skip
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
    const matches = await glob("**/*.{png,jpg,jpeg,tiff,tif,webp,svg,gif}", {
      cwd: dir,
      absolute: true,
    });
    files.push(...matches);
  }

  return files;
}

registerCheck(check);
export default check;
