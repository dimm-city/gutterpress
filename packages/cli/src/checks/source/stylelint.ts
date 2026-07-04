import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { checkCss } from "../../lib/printsafe";

// Print-safety CSS check. Runs print-md's own postcss-based checks (remote
// URLs, risky print effects, Paged.js crash-prone selectors) — no stylelint.
// The id and the `validate.source.stylelint` config key are kept for backward
// compatibility with existing manifests; `false` disables the check.
const check: Check = {
  id: "source.stylelint",
  name: "Print-safety CSS",
  description:
    "Checks CSS for print-safety issues (remote URLs, rasterizing effects, Paged.js crash-prone selectors)",
  category: "source",
  phase: "pre-build",
  // Declarative enable gate: the `validate.source.stylelint` config key toggles
  // this check (kept for manifest back-compat). Consulted by the runner and
  // tool-check via the shared isCheckEnabled(); the run() guard below mirrors it
  // so a direct call still respects the switch.
  enabledWhen: (config) => config.validate.source.stylelint !== false,
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (ctx.config.validate.source.stylelint === false) return [];

    const files = ctx.cssFiles;
    if (!files || files.length === 0) return [];

    const results: CheckResult[] = [];
    for (const file of files) {
      let css: string;
      try {
        css = await readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const w of checkCss(css, file)) {
        results.push({
          checkId: check.id,
          severity: w.severity,
          message: `${w.rule}: ${w.message}`,
          file,
          line: w.line,
          column: w.column,
        });
      }
    }
    return results;
  },
};

registerCheck(check);
export default check;
