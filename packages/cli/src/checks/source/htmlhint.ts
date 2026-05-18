import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const CONFIG_NAMES = [".htmlhintrc"];

function findConfig(inputDir: string, explicit?: string | null): string | null {
  if (explicit) {
    const p = resolve(inputDir, explicit);
    return existsSync(p) ? p : null;
  }
  for (const name of CONFIG_NAMES) {
    const p = resolve(inputDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

const check: Check = {
  id: "source.htmlhint",
  name: "HTMLHint",
  description: "Runs htmlhint with project config to validate generated HTML",
  category: "source",
  phase: "pre-build",
  requiredTools: ["htmlhint"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const sourceConfig = ctx.config.validate.source;
    if (sourceConfig.htmlhint === false) return [];

    // HTMLHint validates the generated HTML file
    if (!ctx.htmlPath || !existsSync(ctx.htmlPath)) return [];

    const configPath =
      typeof sourceConfig.htmlhint === "string"
        ? sourceConfig.htmlhint
        : null;
    const resolvedConfig = findConfig(ctx.inputDir, configPath);

    if (!resolvedConfig && !configPath) return [];

    const args: string[] = ["--format", "json"];
    if (resolvedConfig) {
      args.push("--config", resolvedConfig);
    }
    args.push(ctx.htmlPath);

    try {
      await execCapture("htmlhint", args);
      return [];
    } catch (err) {
      const output =
        err instanceof Error ? err.message : String(err);
      return parseHtmlhintOutput(output, check.id);
    }
  },
};

function parseHtmlhintOutput(
  output: string,
  checkId: string
): CheckResult[] {
  // Try to parse JSON output
  try {
    const jsonStart = output.indexOf("[");
    if (jsonStart >= 0) {
      const jsonStr = output.substring(jsonStart);
      const parsed = JSON.parse(jsonStr) as Array<{
        file: string;
        messages: Array<{
          line: number;
          col: number;
          message: string;
          rule: { id: string };
          type: string;
        }>;
      }>;

      const results: CheckResult[] = [];
      for (const fileResult of parsed) {
        for (const msg of fileResult.messages) {
          results.push({
            checkId,
            severity: msg.type === "error" ? "error" : "warning",
            message: `${msg.rule.id}: ${msg.message}`,
            file: fileResult.file,
            line: msg.line,
            column: msg.col,
          });
        }
      }
      return results;
    }
  } catch {
    // Fall through to line-by-line parsing
  }

  // Fallback: line-by-line parsing
  const results: CheckResult[] = [];
  const linePattern = /^(.+?):(\d+):(\d+):\s*(.+)$/gm;
  let match;
  while ((match = linePattern.exec(output)) !== null) {
    results.push({
      checkId,
      severity: "warning",
      message: match[4]!,
      file: match[1]!,
      line: parseInt(match[2]!, 10),
      column: parseInt(match[3]!, 10),
    });
  }

  if (results.length === 0 && output.trim()) {
    results.push({
      checkId,
      severity: "warning",
      message: output.trim().split("\n")[0]!,
    });
  }

  return results;
}

registerCheck(check);
export default check;
