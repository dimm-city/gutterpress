import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

const check: Check = {
  id: "source.callout-validation",
  name: "Callout Validation",
  description:
    "Validates container/callout types against the allowed list in config",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const allowed = ctx.config.validate.source.allowedCallouts;
    if (!allowed || allowed.length === 0) return [];

    const files = ctx.markdownFiles;
    if (!files || files.length === 0) return [];

    const allowedSet = new Set(allowed);
    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const match = lines[i]!.match(/^:::\s*(\S+)/);
          if (match) {
            const calloutType = match[1]!;
            if (!allowedSet.has(calloutType)) {
              results.push({
                checkId: check.id,
                severity: "warning",
                message: `Unknown container type "${calloutType}". Allowed: ${allowed.join(", ")}`,
                file,
                line: i + 1,
              });
            }
          }
        }
      } catch {
        // File read error, skip
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
