import type {
  Check,
  CheckCategory,
  CheckContext,
  CheckPhase,
  CheckResult,
  CheckSeverity,
} from "./types";
import { getChecks, resolveCheckSelectors } from "./registry";
import { isCheckEnabled } from "./policy";
import type { ResolvedConfig } from "../schema/manifest.types";

export interface RunnerOptions {
  category?: CheckCategory[];
  phase?: CheckPhase;
  only?: string[];
  skip?: string[];
  /** Check IDs to skip due to missing tools (set by tool-check) */
  skipMissingTools?: string[];
}

export interface RunnerReport {
  results: CheckResult[];
  errors: CheckResult[];
  warnings: CheckResult[];
  infos: CheckResult[];
  passed: string[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    passed: number;
  };
}

function getCheckSeverityOverride(
  checkId: string,
  config: ResolvedConfig
): CheckSeverity | undefined {
  const entry = config.validate.checks[checkId];
  if (typeof entry === "object" && entry.severity) return entry.severity;
  return undefined;
}

export async function runChecks(
  ctx: CheckContext,
  opts: RunnerOptions = {}
): Promise<RunnerReport> {
  // Get all checks matching the filter. Track selectors that matched no
  // registered check — a mistyped selector must surface as an error rather
  // than silently resolving to nothing and reporting a false "PASSED".
  const unmatchedSelectors: string[] = [];
  let checks: Check[];
  if (opts.only && opts.only.length > 0) {
    const { resolved, unmatched } = resolveCheckSelectors(opts.only);
    checks = getChecks({ ids: resolved });
    unmatchedSelectors.push(...unmatched);
  } else {
    checks = getChecks({
      category: opts.category,
      phase: opts.phase,
    });
  }

  // Apply skip filter
  if (opts.skip && opts.skip.length > 0) {
    const { resolved, unmatched } = resolveCheckSelectors(opts.skip);
    const skipSet = new Set(resolved);
    checks = checks.filter((c) => !skipSet.has(c.id));
    unmatchedSelectors.push(...unmatched);
  }

  // Filter by manifest enable/disable
  if (ctx.config.validate.enabled === false) {
    return emptyReport();
  }
  checks = checks.filter((c) => isCheckEnabled(c, ctx.config));

  // Filter out checks skipped due to missing tools
  if (opts.skipMissingTools && opts.skipMissingTools.length > 0) {
    const toolSkipSet = new Set(opts.skipMissingTools);
    checks = checks.filter((c) => !toolSkipSet.has(c.id));
  }

  const allResults: CheckResult[] = [];
  const passed: string[] = [];

  // Surface mistyped selectors as errors so a run that matched nothing can
  // never be reported as a silent green.
  for (const selector of unmatchedSelectors) {
    allResults.push({
      checkId: "selector.unmatched",
      severity: "error",
      message: `Unknown check selector "${selector}" matched no registered checks.`,
    });
  }

  for (const check of checks) {
    try {
      const results = await check.run(ctx);

      // Apply severity overrides from config
      const severityOverride = getCheckSeverityOverride(check.id, ctx.config);
      if (severityOverride) {
        for (const r of results) {
          r.severity = severityOverride;
        }
      }

      if (results.length === 0) {
        passed.push(check.id);
      } else {
        allResults.push(...results);
      }
    } catch (err) {
      allResults.push({
        checkId: check.id,
        severity: "error",
        message: `Check "${check.id}" threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const errors = allResults.filter((r) => r.severity === "error");
  const warnings = allResults.filter((r) => r.severity === "warning");
  const infos = allResults.filter((r) => r.severity === "info");

  return {
    results: allResults,
    errors,
    warnings,
    infos,
    passed,
    summary: {
      total: checks.length,
      errors: errors.length,
      warnings: warnings.length,
      infos: infos.length,
      passed: passed.length,
    },
  };
}

function emptyReport(): RunnerReport {
  return {
    results: [],
    errors: [],
    warnings: [],
    infos: [],
    passed: [],
    summary: { total: 0, errors: 0, warnings: 0, infos: 0, passed: 0 },
  };
}
