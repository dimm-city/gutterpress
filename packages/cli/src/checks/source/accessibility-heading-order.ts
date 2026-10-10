import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import { parseDisableDirective } from "../../lib/lint-rules";
import type { Check, CheckContext, CheckResult } from "../types";

const check: Check = {
  id: "source.accessibility.heading-order",
  name: "Heading Order",
  description: "Checks markdown heading levels do not jump by more than one",
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
        let prevLevel: number | undefined;
        // `<!-- gutterpress-disable-next-line <check-id> -->` silences this
        // check on the line directly below it.
        let silencedLine = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
          }
          if (inFence) continue;

          const comment = /^\s*<!--(.*)-->\s*$/.exec(line);
          if (comment && parseDisableDirective(comment[1]!)?.includes(check.id)) {
            silencedLine = i + 1;
            continue;
          }

          const match = line.match(/^(#{1,6})\s+\S/);
          if (!match) continue;

          const level = match[1]!.length;
          if (prevLevel != null && level > prevLevel + 1 && i !== silencedLine) {
            results.push({
              checkId: check.id,
              severity: "warning",
              message: `Heading level jump from h${prevLevel} to h${level}`,
              file,
              line: i + 1,
            });
          }
          prevLevel = level;
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
