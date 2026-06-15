import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectImage, collectImageFiles } from "../../lib/image-inspect";

// Map the reader's coarse color-space token to the human label used in the
// allowed-list config (which historically mirrored ImageMagick's vocabulary).
const LABEL: Record<string, string> = {
  srgb: "sRGB",
  gray: "Gray",
  cmyk: "CMYK",
};

const check: Check = {
  id: "asset.image.color-space",
  name: "Image Color Space",
  description: "Validates image color spaces against allowed list",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const allowed = ctx.config.validate.assets.allowedColorSpaces;
    if (!allowed || allowed.length === 0) return [];

    const dirs = ctx.assetDirs ?? [ctx.inputDir];
    const files = await collectImageFiles(dirs, ["png", "jpg", "jpeg", "tiff", "tif"]);
    if (files.length === 0) return [];

    const allowedLower = new Set(allowed.map((s) => s.toLowerCase()));
    const results: CheckResult[] = [];

    for (const file of files) {
      const info = await inspectImage(file);
      const cs = info?.colorSpace;
      if (cs && !allowedLower.has(cs)) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: `Image uses ${LABEL[cs] ?? cs} color space (allowed: ${allowed.join(", ")})`,
          file,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
