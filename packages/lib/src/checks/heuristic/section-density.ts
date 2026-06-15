import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

const check: Check = {
  id: "heuristic.chunking.section-density",
  name: "Section Density",
  description:
    "Checks heading/paragraph/callout density from source Markdown",
  category: "heuristic",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const maxParas = ctx.config.validate.heuristics.maxParagraphsPerSection;
    if (!maxParas) return [];

    const files = ctx.markdownFiles;
    if (!files || files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");

        let currentSectionStart = 0;
        let paragraphCount = 0;
        let inParagraph = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;

          // Heading starts new section
          if (/^#{1,6}\s/.test(line)) {
            if (paragraphCount > maxParas) {
              results.push({
                checkId: check.id,
                severity: "info",
                message: `Section has ${paragraphCount} paragraphs (max recommended: ${maxParas})`,
                file,
                line: currentSectionStart + 1,
              });
            }
            currentSectionStart = i;
            paragraphCount = 0;
            inParagraph = false;
            continue;
          }

          // Count paragraph transitions
          if (line.trim() === "") {
            inParagraph = false;
          } else if (!inParagraph) {
            inParagraph = true;
            paragraphCount++;
          }
        }

        // Check last section
        if (paragraphCount > maxParas) {
          results.push({
            checkId: check.id,
            severity: "info",
            message: `Section has ${paragraphCount} paragraphs (max recommended: ${maxParas})`,
            file,
            line: currentSectionStart + 1,
          });
        }
      } catch {
        // File read error
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
