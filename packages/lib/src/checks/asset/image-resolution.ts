import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectImage, collectImageFiles } from "../../lib/image-inspect";

const check: Check = {
  id: "asset.image.resolution",
  name: "Image Resolution",
  description: "Checks source image DPI from embedded density metadata",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const minDpi = ctx.config.validate.assets.minImageDpi;
    if (!minDpi) return [];

    const dirs = ctx.assetDirs ?? [ctx.inputDir];
    const files = await collectImageFiles(dirs, ["png", "jpg", "jpeg", "tiff", "tif"]);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];
    for (const file of files) {
      const info = await inspectImage(file);
      if (!info) continue;
      const { xDpi, yDpi } = info;
      if (xDpi > 0 && yDpi > 0 && (xDpi < minDpi || yDpi < minDpi)) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: `Image resolution too low: ${xDpi}x${yDpi} DPI (minimum ${minDpi} DPI)`,
          file,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
