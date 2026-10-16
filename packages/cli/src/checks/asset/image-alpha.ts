import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectImage } from "../../lib/image-inspect";
import { shippedImages } from "./extensions";

const check: Check = {
  id: "asset.image.alpha-channel",
  name: "Image Alpha Channel",
  description: "Checks for alpha channels in PNG/TIFF images",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (ctx.config.validate.assets.allowAlpha) return [];
    // `preserve-text` flattens a transparent page's artwork and keeps its text
    // live, so an alpha channel costs nothing in print; only `flatten-page`
    // loses the page's text to it.
    if (ctx.config.pdfx.transparency === "preserve-text") return [];

    // Deliberate subset of RASTER_INSPECTABLE_EXTS: JPEG cannot carry an alpha
    // channel, so only the alpha-capable inspectable formats are scanned here.
    const files = shippedImages(ctx, ["png", "tiff", "tif"]);
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
