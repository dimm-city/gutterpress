import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import type { Config } from "stylelint";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

const check: Check = {
  id: "source.stylelint",
  name: "Stylelint",
  description:
    "Runs stylelint to validate CSS files, integrating with existing lint infrastructure",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const sourceConfig = ctx.config.validate.source;
    if (sourceConfig.stylelint === false) return [];

    const files = ctx.cssFiles;
    if (!files || files.length === 0) return [];

    // Determine config path: validate.source.stylelint > lint.configPath > auto-detect
    let configPath: string | null = null;
    if (typeof sourceConfig.stylelint === "string") {
      configPath = resolve(ctx.inputDir, sourceConfig.stylelint);
    } else if (ctx.config.lint.configPath) {
      configPath = resolve(ctx.inputDir, ctx.config.lint.configPath);
    }

    if (configPath && !existsSync(configPath)) {
      configPath = null;
    }

    try {
      let stylelintConfig: unknown;
      if (configPath) {
        stylelintConfig = require(configPath);
      } else {
        stylelintConfig = (await import("../../stylelint/stylelint.config")).default;
      }

      const { default: stylelint } = await import("stylelint");
      const result = await stylelint.lint({
        files,
        config: stylelintConfig as Config,
        configBasedir: configPath ? dirname(configPath) : import.meta.dirname,
        formatter: "json",
      });

      if (result.errored) {
        return parseStylelintOutput(result.report ?? "", check.id);
      }

      return [];
    } catch (err) {
      const output =
        err instanceof Error ? err.message : String(err);
      return parseStylelintOutput(output, check.id);
    }
  },
};

function parseStylelintOutput(
  output: string,
  checkId: string
): CheckResult[] {
  try {
    const jsonStart = output.indexOf("[");
    if (jsonStart >= 0) {
      const jsonStr = output.substring(jsonStart);
      const parsed = JSON.parse(jsonStr) as Array<{
        source: string;
        warnings: Array<{
          line: number;
          column: number;
          text: string;
          rule: string;
          severity: string;
        }>;
      }>;

      const results: CheckResult[] = [];
      for (const fileResult of parsed) {
        for (const w of fileResult.warnings) {
          results.push({
            checkId,
            severity: w.severity === "error" ? "error" : "warning",
            message: `${w.rule}: ${w.text}`,
            file: fileResult.source,
            line: w.line,
            column: w.column,
          });
        }
      }
      return results;
    }
  } catch {
    // Fall through
  }

  if (output.trim()) {
    return [
      {
        checkId,
        severity: "warning",
        message: output.trim().split("\n")[0]!,
      },
    ];
  }

  return [];
}

registerCheck(check);
export default check;
