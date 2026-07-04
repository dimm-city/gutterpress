import { stat } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { collectImageFiles } from "../../lib/image-inspect";
import { ALL_IMAGE_EXTS } from "./extensions";

const check: Check = {
  id: "asset.image.file-size",
  name: "Image File Size",
  description: "Checks that image files do not exceed the maximum size limit",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const maxSize = ctx.config.validate.assets.maxImageSize;
    if (!maxSize) return [];

    const dirs = ctx.assetDirs ?? [ctx.inputDir];
    const files = await collectImageFiles(dirs, ALL_IMAGE_EXTS);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const info = await stat(file);
        if (info.size > maxSize) {
          const sizeMb = (info.size / 1_000_000).toFixed(1);
          const maxMb = (maxSize / 1_000_000).toFixed(1);
          results.push(
            finding(check.id, {
              severity: "warning",
              message: `Image file too large: ${sizeMb}MB (max ${maxMb}MB)`,
              file,
            })
          );
        }
      } catch {
        results.push(
          inspectionFailed(check.id, `Could not stat image file: ${file}`, {
            file,
          })
        );
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
