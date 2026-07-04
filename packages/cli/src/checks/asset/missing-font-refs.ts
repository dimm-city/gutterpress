import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";

const FONT_FACE_PATTERN = /@font-face\s*\{[^}]*src:\s*([^;]+)/g;
const URL_PATTERN = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g;

const check: Check = {
  id: "asset.font.missing-refs",
  name: "Missing Font References",
  description:
    "Cross-references CSS @font-face src with font files on disk",
  category: "asset",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const files = ctx.cssFiles;
    if (!files || files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const cssFile of files) {
      try {
        const content = await readFile(cssFile, "utf8");
        const cssDir = dirname(cssFile);

        let fontFaceMatch;
        FONT_FACE_PATTERN.lastIndex = 0;

        while (
          (fontFaceMatch = FONT_FACE_PATTERN.exec(content)) !== null
        ) {
          const srcValue = fontFaceMatch[1]!;
          let urlMatch;
          URL_PATTERN.lastIndex = 0;

          while ((urlMatch = URL_PATTERN.exec(srcValue)) !== null) {
            const fontUrl = urlMatch[1]!;
            // Skip data URIs and external URLs
            if (fontUrl.startsWith("data:")) continue;
            if (/^https?:\/\//.test(fontUrl)) continue;

            // Remove query string and fragment
            const cleanUrl = fontUrl.split("?")[0]!.split("#")[0]!;
            const fontPath = resolve(cssDir, cleanUrl);

            if (!existsSync(fontPath)) {
              results.push(
                finding(check.id, {
                  severity: "error",
                  message: `Font file not found: ${cleanUrl}`,
                  file: cssFile,
                })
              );
            }
          }
        }
      } catch {
        results.push(
          inspectionFailed(check.id, `Could not read CSS file: ${cssFile}`, {
            file: cssFile,
          })
        );
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
