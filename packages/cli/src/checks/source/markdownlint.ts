import { readFile } from "node:fs/promises";
import { lint } from "markdownlint/sync";
import { parse as parseYaml } from "yaml";
import { registerCheck } from "../registry";
import { findConfigFile } from "./config-file";
import type { Check, CheckContext, CheckResult } from "../types";

const CONFIG_NAMES = [
  ".markdownlint.yaml",
  ".markdownlint.yml",
  ".markdownlint.json",
  ".markdownlint.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlint-cli2.jsonc",
];

/** Strip line and block comments so JSONC config files parse as JSON. */
function stripJsonComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // ignore // not preceded by : (URLs)
}

/**
 * Load a markdownlint config object from a discovered config file. The parser
 * is selected by extension (.json → JSON, .jsonc → JSON minus comments, else
 * YAML — which also accepts plain JSON). markdownlint-cli2-style files nest the
 * rules under a `config:` key; plain markdownlint files are the rules object
 * directly, so `parsed.config ?? parsed` handles both shapes.
 */
async function loadConfig(
  configPath: string
): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, "utf8");
  let parsed: unknown;
  if (configPath.endsWith(".json")) {
    parsed = JSON.parse(raw);
  } else if (configPath.endsWith(".jsonc")) {
    parsed = JSON.parse(stripJsonComments(raw));
  } else {
    parsed = parseYaml(raw);
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (obj.config && typeof obj.config === "object") {
      return obj.config as Record<string, unknown>;
    }
    return obj;
  }
  return {};
}

interface MarkdownlintError {
  lineNumber: number;
  ruleNames: string[];
  ruleDescription: string;
  errorRange?: [number, number] | null;
}

const check: Check = {
  id: "source.markdownlint",
  name: "Markdownlint",
  description:
    "Runs markdownlint with project config to validate Markdown files",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const sourceConfig = ctx.config.validate.source;
    if (sourceConfig.markdownlint === false) return [];

    const files = ctx.markdownFiles;
    if (!files || files.length === 0) return [];

    const configPath =
      typeof sourceConfig.markdownlint === "string"
        ? sourceConfig.markdownlint
        : null;
    const resolvedConfig = findConfigFile(ctx.inputDir, CONFIG_NAMES, configPath);

    // If no config found and not explicitly set, skip silently
    if (!resolvedConfig && !configPath) return [];

    // Explicit-but-missing config falls back to defaults (matches prior CLI run
    // with no --config flag).
    const config = resolvedConfig
      ? await loadConfig(resolvedConfig)
      : { default: true };

    const results = lint({ files, config }) as Record<
      string,
      MarkdownlintError[]
    >;

    const out: CheckResult[] = [];
    for (const [file, violations] of Object.entries(results)) {
      if (!Array.isArray(violations)) continue;
      for (const v of violations) {
        out.push({
          checkId: check.id,
          severity: "warning",
          // Format mirrors markdownlint-cli2 text output: "rule/alias description"
          message: `${v.ruleNames.join("/")} ${v.ruleDescription}`,
          file,
          line: v.lineNumber,
          column: v.errorRange?.[0],
        });
      }
    }
    return out;
  },
};

registerCheck(check);
export default check;
