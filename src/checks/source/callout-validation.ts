import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

const BUILTIN_CONTAINERS = [
  "sidebar",
  "wrapper",
  "ability",
  "ability-continued",
  "dc-specialty",
  "learning-path",
  "container",
  "aug",
  "two-column",
  "three-column",
  "callout-note",
  "callout-warning",
  "callout-caution",
  "callout-tip",
  "callout",
  "pull-quote",
  "procedure",
  "item",
  "lede",
] as const;

function getContainerType(line: string): string | null {
  const match = line.match(/^(:{3,})\s+([^:\s]\S*)/);
  return match?.[2] ?? null;
}

const check: Check = {
  id: "source.callout-validation",
  name: "Callout Validation",
  description:
    "Validates container/callout types against the allowed list in config",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const allowed = [
      ...new Set([...BUILTIN_CONTAINERS, ...ctx.config.validate.source.allowedCallouts]),
    ];

    const files = ctx.markdownFiles;
    if (!files || files.length === 0) return [];

    const allowedSet = new Set(allowed);
    const results: CheckResult[] = [];

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const calloutType = getContainerType(lines[i]!);
          if (calloutType) {
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
