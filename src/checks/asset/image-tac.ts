import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const check: Check = {
  id: "asset.image.tac-raster",
  name: "Image TAC (Raster)",
  description: "Rasterizes and checks TAC per image using Ghostscript",
  category: "asset",
  phase: "pre-build",
  requiredTools: ["gs"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const maxTac = ctx.config.ink.maxTac;
    if (!maxTac) return [];

    const files = await collectImageFiles(ctx);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const { stdout } = await execCapture("gs", [
          "-q",
          "-dBATCH",
          "-dNOPAUSE",
          "-sDEVICE=inkcov",
          file,
        ]);

        // Parse ink coverage output
        const lines = stdout.split(/\r?\n/).filter((l) => l.includes("CMYK"));
        for (const line of lines) {
          const nums = line.trim().split(/\s+/).slice(0, 4).map(Number);
          if (
            nums.length === 4 &&
            nums.every((n) => Number.isFinite(n))
          ) {
            const tac = (nums[0]! + nums[1]! + nums[2]! + nums[3]!) * 100;
            if (tac > maxTac) {
              results.push({
                checkId: check.id,
                severity: "warning",
                message: `Image TAC exceeds limit: ${tac.toFixed(1)}% (max ${maxTac}%)`,
                file,
              });
              break;
            }
          }
        }
      } catch {
        // gs not available or failed
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
