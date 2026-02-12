import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "asset.image.alpha-channel",
  name: "Image Alpha Channel",
  description: "Checks for alpha channels in PNG/TIFF images",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (ctx.config.validate.assets.allowAlpha) return [];

    const files = await collectImageFiles(ctx);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const { stdout } = await execCapture("identify", [
          "-format",
          "%A",
          file,
        ]);
        const hasAlpha = stdout.trim().toLowerCase();

        if (hasAlpha === "true" || hasAlpha === "blend") {
          results.push({
            checkId: check.id,
            severity: "warning",
            message:
              "Image contains alpha channel, which may cause print issues",
            file,
          });
        }
      } catch {
        // identify not available
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
    const matches = await glob("**/*.{png,tiff,tif}", {
      cwd: dir,
      absolute: true,
    });
    files.push(...matches);
  }

  return files;
}

registerCheck(check);
export default check;
