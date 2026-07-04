import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { execCapture } from "../../lib/exec";
import { collectImageFiles } from "../../lib/image-inspect";
import { RASTER_INSPECTABLE_EXTS } from "./extensions";

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

    const dirs = ctx.assetDirs ?? [ctx.inputDir];
    const files = await collectImageFiles(dirs, RASTER_INSPECTABLE_EXTS);
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
              results.push(
                finding(check.id, {
                  severity: "warning",
                  message: `Image TAC exceeds limit: ${tac.toFixed(1)}% (max ${maxTac}%)`,
                  file,
                  code: "image-tac-exceeded",
                  data: { tac, limit: maxTac },
                })
              );
              break;
            }
          }
        }
      } catch {
        // gs was probed as available (requiredTools gate) but failed on this
        // image — an inspection failure, surfaced rather than silently dropped.
        results.push(
          inspectionFailed(
            check.id,
            `Could not inspect image ink coverage: ${file}`,
            { file }
          )
        );
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
