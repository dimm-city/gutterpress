import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HTMLHint } from "htmlhint";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";

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

    // A .htmlhintrc replaces the default ruleset (matches the prior `--config`
    // CLI behavior). No config → HTMLHint's built-in defaults. NEVER pass `{}`:
    // an empty ruleset disables every rule in HTMLHint.verify().
    const ruleset = resolvedConfig
      ? (JSON.parse(
          await readFile(resolvedConfig, "utf8")
        ) as typeof HTMLHint.defaultRuleset)
      : HTMLHint.defaultRuleset;

    const html = await readFile(ctx.htmlPath, "utf8");
    const messages = HTMLHint.verify(html, ruleset);

    return messages.map((m) => ({
      checkId: check.id,
      severity: m.type === "error" ? ("error" as const) : ("warning" as const),
      message: `${m.rule.id}: ${m.message}`,
      file: ctx.htmlPath!,
      line: m.line,
      column: m.col,
    }));
  },
};

registerCheck(check);
export default check;
