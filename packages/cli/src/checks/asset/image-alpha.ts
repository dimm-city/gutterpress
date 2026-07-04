import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectImage, collectImageFiles } from "../../lib/image-inspect";

const check: Check = {
  id: "asset.image.alpha-channel",
  name: "Image Alpha Channel",
  description: "Checks for alpha channels in PNG/TIFF images",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (ctx.config.validate.assets.allowAlpha) return [];

    const dirs = ctx.assetDirs ?? [ctx.inputDir];
    // Deliberate subset of RASTER_INSPECTABLE_EXTS: JPEG cannot carry an alpha
    // channel, so only the alpha-capable inspectable formats are scanned here.
    const files = await collectImageFiles(dirs, ["png", "tiff", "tif"]);
    if (files.length === 0) return [];

    const results: CheckResult[] = [];
    for (const file of files) {
      const info = await inspectImage(file);
      if (info?.hasAlpha) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: "Image contains alpha channel, which may cause print issues",
          file,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
