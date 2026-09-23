/**
 * `gutterpress validate --fix` (#275): apply markdownlint's own auto-fixes to
 * the project's markdown, in place.
 *
 * Deliberately scoped to `source.markdownlint`. The other source checks
 * (local-refs, accessibility.*, layout-markers, merge-markers, print-safety
 * CSS) have no mechanical fix and stay read-only, and so does a plain
 * `validate` run: nothing here happens unless the caller passed `--fix`.
 *
 * Config discovery is the SAME `findConfigFile` + `loadConfig` pair the check
 * itself uses (checks/source/markdownlint.ts), so the fixer and the check can
 * never disagree about which rules apply.
 *
 * Every message goes to stderr (`log.warn`): `executeValidation`'s stdout
 * belongs to `formatReport`, and `validate --format json --fix` has to stay
 * machine-parseable.
 */
import { readFile, writeFile } from "node:fs/promises";
import { applyFixes } from "markdownlint";
import { lint } from "markdownlint/sync";
import type { LintError } from "markdownlint";
import { log } from "../utils/logger";
import { findConfigFile } from "../checks/source/config-file";
import { CONFIG_NAMES, loadConfig } from "../checks/source/markdownlint";
import { detectProjectSource, repoSubPath } from "./project-source";
import { listWorkdirChanges } from "./source-provider";
import type { CheckContext } from "../checks/types";

/**
 * Which of `files` already had uncommitted changes. `listWorkdirChanges`
 * (source-provider.ts) is the repo's own WORKDIR-vs-STAGE walk via
 * isomorphic-git — never the system `git` binary (CLAUDE.md §7). A project
 * with no repo above it, or a repo the walk cannot read, simply yields no
 * notice; a dirty tree never blocks the fix.
 */
async function uncommittedAmong(
  inputDir: string,
  files: string[]
): Promise<string[]> {
  const source = await detectProjectSource(inputDir);
  if (source.type !== "local-git-folder") return [];
  const repoRoot = source.repoRoot;
  let changed: Set<string>;
  try {
    const { adds } = await listWorkdirChanges(repoRoot);
    changed = new Set(adds);
  } catch {
    return [];
  }
  return files.filter((file) => changed.has(repoSubPath(repoRoot, file)));
}

/**
 * Rewrite every markdown file in `ctx` whose markdownlint violations have a
 * mechanical fix. Returns the absolute paths actually written, and prints
 * them, so the write is never invisible.
 */
export async function applyMarkdownlintFixes(
  ctx: CheckContext
): Promise<string[]> {
  const sourceConfig = ctx.config.validate.source;
  if (sourceConfig.markdownlint === false) {
    log.warn(
      "--fix: source.markdownlint is disabled for this project — no files were fixed."
    );
    return [];
  }

  const files = ctx.markdownFiles;
  if (!files || files.length === 0) {
    log.warn("--fix: no markdown files to fix.");
    return [];
  }

  const configPath =
    typeof sourceConfig.markdownlint === "string"
      ? sourceConfig.markdownlint
      : null;
  const resolvedConfig = findConfigFile(ctx.inputDir, CONFIG_NAMES, configPath);

  // The check skips SILENTLY when no config is found; an explicit --fix must
  // say so rather than look like a successful no-op.
  if (!resolvedConfig && !configPath) {
    log.warn(
      `--fix: no markdownlint config found in ${ctx.inputDir} (looked for ${CONFIG_NAMES.join(", ")}) — no files were fixed.`
    );
    return [];
  }

  const config = resolvedConfig
    ? await loadConfig(resolvedConfig)
    : { default: true };

  const results = lint({ files, config }) as unknown as Record<
    string,
    LintError[]
  >;

  const pending: Array<{ file: string; content: string }> = [];
  for (const [file, violations] of Object.entries(results)) {
    if (!Array.isArray(violations) || violations.length === 0) continue;
    const before = await readFile(file, "utf8");
    const after = applyFixes(before, violations);
    if (after !== before) pending.push({ file, content: after });
  }

  if (pending.length === 0) {
    log.warn("--fix: no mechanically fixable markdownlint violations found.");
    return [];
  }

  // Computed BEFORE the writes — afterwards every rewritten file is dirty.
  const dirty = await uncommittedAmong(
    ctx.inputDir,
    pending.map((p) => p.file)
  );

  for (const { file, content } of pending) {
    await writeFile(file, content, "utf8");
  }

  log.warn(`--fix: rewrote ${pending.length} file(s):`);
  for (const { file } of pending) log.warn(`  ${file}`);
  if (dirty.length > 0) {
    log.warn(
      `--fix: ${dirty.length} of those already had uncommitted changes and were rewritten anyway: ${dirty.join(", ")}`
    );
  }

  return pending.map((p) => p.file);
}
