// Self-populate the check registry (audit B5 / review): this module is
// reachable without ever importing checks/runner (its own bootstrap), and an
// empty registry here would silently report "no tools needed".
import "./register-builtins";
import { selectChecks } from "./policy";
import { log } from "../utils/logger";
import { isToolAvailable } from "../lib/tool-probe";
import { resolveGhostscript } from "../lib/ghostscript";
import type { ResolvedConfig } from "../schema/manifest.types";
import type { RunnerOptions } from "./runner";

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
  // Get the same set of checks the runner would use (before tool filtering),
  // via the SHARED selector (audit E10) so tool probing can never drift from
  // execution. Unmatched (mistyped) selectors are deliberately NOT surfaced
  // here: this function is always paired with runChecks (see validation-exec.ts),
  // which owns selector validation and emits a `selector.unmatched` error for
  // every typo in `only`/`skip`. Re-reporting them here would double-warn; a
  // typo can never produce a silent green because the runner's error fails the
  // report.
  const { checks } = selectChecks(opts, config);

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
      found: tool === "gs"
        ? !!(await resolveGhostscript())
        : await isToolAvailable(tool),
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
