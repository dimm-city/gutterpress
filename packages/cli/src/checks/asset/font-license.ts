import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { ASSET_SCAN_IGNORE_GLOBS, FONT_EXTS } from "./extensions";

const LICENSE_NAMES = [
  "LICENSE",
  "LICENSE.txt",
  "LICENSE.md",
  "LICENCE",
  "LICENCE.txt",
  "OFL.txt",
  "OFL-1.1.txt",
  "COPYING",
];

const check: Check = {
  id: "asset.font.license",
  name: "Font License",
  description: "Checks for license files in font directories",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.config.validate.assets.requireFontLicense) return [];

    const { glob } = await import("glob");
    const dirs = ctx.assetDirs ?? [ctx.inputDir];

    // Find directories that contain font files
    const fontDirs = new Set<string>();
    for (const dir of dirs) {
      const matches = await glob(`**/*.{${FONT_EXTS.join(",")}}`, {
        cwd: dir,
        absolute: true,
        ignore: [...ASSET_SCAN_IGNORE_GLOBS],
      });
      for (const m of matches) {
        fontDirs.add(resolve(m, ".."));
      }
    }

    const results: CheckResult[] = [];
    for (const fontDir of fontDirs) {
      const hasLicense = LICENSE_NAMES.some((name) =>
        existsSync(resolve(fontDir, name))
      );
      if (!hasLicense) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: `No font license file found in directory`,
          file: fontDir,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
