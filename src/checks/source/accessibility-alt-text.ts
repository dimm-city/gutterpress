import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

const check: Check = {
  id: "source.accessibility.alt-text",
  name: "Image Alt Text",
  description: "Checks markdown images include non-empty alt text",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const files = (ctx.markdownFiles ?? []).slice().sort();
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");
        let inFence = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
          }
          if (inFence) continue;

          for (const alt of extractImageAlts(line)) {
            if (alt.trim()) continue;
            results.push({
              checkId: check.id,
              severity: "warning",
              message: "Image is missing alt text",
              file,
              line: i + 1,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  },
};

function extractImageAlts(line: string): string[] {
  const alts: string[] = [];
  const inlinePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const referencePattern = /!\[([^\]]*)\]\[[^\]]*\]/g;

  for (const match of line.matchAll(inlinePattern)) {
    alts.push(match[1] ?? "");
  }
  for (const match of line.matchAll(referencePattern)) {
    alts.push(match[1] ?? "");
  }

  return alts;
}

registerCheck(check);
export default check;
