import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { execCapture } from "../../lib/exec";

const CONFIG_NAMES = [
  ".markdownlint.yaml",
  ".markdownlint.yml",
  ".markdownlint.json",
  ".markdownlint.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlint-cli2.jsonc",
];

function findConfig(inputDir: string, explicit?: string | null): string | null {
  if (explicit) {
    const p = resolve(inputDir, explicit);
    return existsSync(p) ? p : null;
  }
  // Auto-detect
  for (const name of CONFIG_NAMES) {
    const p = resolve(inputDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

const check: Check = {
  id: "source.markdownlint",
  name: "Markdownlint",
  description:
    "Runs markdownlint-cli2 with project config to validate Markdown files",
  category: "source",
  phase: "pre-build",
  requiredTools: ["markdownlint-cli2"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const sourceConfig = ctx.config.validate.source;
    if (sourceConfig.markdownlint === false) return [];

    const files = ctx.markdownFiles;
    if (!files || files.length === 0) return [];

    const configPath =
      typeof sourceConfig.markdownlint === "string"
        ? sourceConfig.markdownlint
        : null;
    const resolvedConfig = findConfig(ctx.inputDir, configPath);

    // If no config found and not explicitly set, skip silently
    if (!resolvedConfig && !configPath) return [];

    const args: string[] = [];
    if (resolvedConfig) {
      args.push("--config", resolvedConfig);
    }
    args.push(...files);

    try {
      await execCapture("markdownlint-cli2", args);
      return [];
    } catch (err) {
      // markdownlint-cli2 exits non-zero when violations found
      const output =
        err instanceof Error ? err.message : String(err);
      return parseMarkdownlintOutput(output, check.id);
    }
  },
};

function parseMarkdownlintOutput(
  output: string,
  checkId: string
): CheckResult[] {
  const results: CheckResult[] = [];
  // Format: filepath:line[:column] rule/alias description
  const linePattern = /^(.+?):(\d+)(?::(\d+))?\s+(\S+)\s+(.+)$/gm;
  let match;

  while ((match = linePattern.exec(output)) !== null) {
    results.push({
      checkId,
      severity: "warning",
      message: `${match[4]} ${match[5]}`,
      file: match[1]!,
      line: parseInt(match[2]!, 10),
      column: match[3] ? parseInt(match[3], 10) : undefined,
    });
  }

  // If no parseable lines but there was output, report the raw error
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
