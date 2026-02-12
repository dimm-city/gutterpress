import { spawn } from "node:child_process";
import { getChecks } from "./registry";
import { log } from "../lib/logger";
import type { ResolvedConfig } from "../schema/manifest.types";
import type { CheckCategory, CheckPhase } from "./types";
import type { RunnerOptions } from "./runner";

/**
 * Test whether a CLI command is available on the system.
 * Uses `which` (Unix) to check, falling back to a direct spawn test.
 */
async function isToolAvailable(tool: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("which", [tool], { stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

export interface ToolCheckResult {
  /** Tools that were checked and found present */
  available: string[];
  /** Tools that are missing */
  missing: string[];
  /** Check IDs that will be skipped due to missing tools */
  skippedChecks: string[];
  /** Mapping: missing tool → check IDs that need it */
  toolToChecks: Map<string, string[]>;
}

/**
 * Checks whether external tools required by active checks are installed.
 * Skips tools whose only dependent checks are explicitly disabled in the manifest.
 * Returns which tools are missing and which checks will be skipped.
 */
export async function checkToolAvailability(
  config: ResolvedConfig,
  opts: RunnerOptions = {}
): Promise<ToolCheckResult> {
  // Get the same set of checks the runner would use (before tool filtering)
  let checks = opts.only?.length
    ? getChecks({ ids: opts.only })
    : getChecks({ category: opts.category, phase: opts.phase });

  // Apply skip filter
  if (opts.skip?.length) {
    const skipSet = new Set(opts.skip);
    checks = checks.filter((c) => !skipSet.has(c.id));
  }

  // Filter out checks disabled in manifest
  checks = checks.filter((c) => {
    const entry = config.validate.checks[c.id];
    if (entry === false) return false;
    if (typeof entry === "object" && entry.enabled === false) return false;
    return true;
  });

  // Also filter out source checks disabled via their tool-specific config
  checks = checks.filter((c) => {
    if (c.id === "source.markdownlint" && config.validate.source.markdownlint === false) return false;
    if (c.id === "source.htmlhint" && config.validate.source.htmlhint === false) return false;
    if (c.id === "source.stylelint" && config.validate.source.stylelint === false) return false;
    return true;
  });

  // Build tool → check IDs mapping (only for checks that declare requiredTools)
  const toolToChecks = new Map<string, string[]>();
  for (const check of checks) {
    if (!check.requiredTools?.length) continue;
    for (const tool of check.requiredTools) {
      const existing = toolToChecks.get(tool);
      if (existing) {
        existing.push(check.id);
      } else {
        toolToChecks.set(tool, [check.id]);
      }
    }
  }

  // No external tools needed
  if (toolToChecks.size === 0) {
    return { available: [], missing: [], skippedChecks: [], toolToChecks };
  }

  // Probe all tools in parallel
  const toolNames = Array.from(toolToChecks.keys());
  const results = await Promise.all(
    toolNames.map(async (tool) => ({
      tool,
      found: await isToolAvailable(tool),
    }))
  );

  const available = results.filter((r) => r.found).map((r) => r.tool);
  const missing = results.filter((r) => !r.found).map((r) => r.tool);

  // Collect check IDs that will be skipped (all their required tools must be available)
  const missingSet = new Set(missing);
  const skippedChecks: string[] = [];
  for (const check of checks) {
    if (!check.requiredTools?.length) continue;
    if (check.requiredTools.some((t) => missingSet.has(t))) {
      skippedChecks.push(check.id);
    }
  }

  return { available, missing, skippedChecks, toolToChecks };
}

/**
 * Log warnings for missing tools, showing which checks will be skipped.
 */
export function reportMissingTools(result: ToolCheckResult): void {
  if (result.missing.length === 0) return;

  for (const tool of result.missing) {
    const checkIds = result.toolToChecks.get(tool) ?? [];
    // Only list checks that are actually affected (their tool is missing)
    const affected = checkIds.filter((id) => result.skippedChecks.includes(id));
    if (affected.length === 0) continue;

    log.warn(
      `Tool "${tool}" not found — skipping: ${affected.join(", ")}`
    );
  }
}
