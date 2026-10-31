import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { checkCss } from "../../lib/printsafe";

// Print-safety CSS check. Runs gutterpress's own postcss-based checks (remote
// URLs, risky print effects, page-layer containment hints) — no stylelint.
// The id is kept for backward compatibility with existing manifests;
// `checks: { source.stylelint: off }` disables the check.
const check: Check = {
  id: "source.stylelint",
  name: "Print-safety CSS",
  description:
    "Checks CSS for print-safety issues (remote URLs, rasterizing effects, and page-layer containment)",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const files = ctx.cssFiles;
    if (!files || files.length === 0) return [];

    const results: CheckResult[] = [];
    for (const file of files) {
      let css: string;
      try {
        css = await readFile(file, "utf8");
      } catch (err) {
        // An unreadable configured stylesheet is an error finding, not a
        // silent skip (#272) — this is now the ONLY CSS print-safety gate a
        // build runs, so a missing/unreadable file must fail loudly here
        // rather than let the build report "validated" having inspected
        // nothing.
        results.push({
          checkId: check.id,
          severity: "error",
          message: `Cannot read stylesheet: ${err instanceof Error ? err.message : String(err)}`,
          file,
        });
        continue;
      }
      for (const w of checkCss(css, file, { rules: ctx.config.checks })) {
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
