import type {
  CheckCategory,
  CheckContext,
  CheckPhase,
  CheckResult,
  CheckSeverity,
} from "./types";
// Self-populate the check registry no matter who reaches runChecks first
// (audit B5) — this replaces the implicit reliance on validation-exec.ts's
// side-effect imports running before any caller.
import "./register-builtins";
import { selectChecks } from "./policy";
// Static import is free here: register-builtins above already pulls pdf-inspect
// (and its eager unpdf import) via the pdf check modules.
import { retainPdfCache } from "../lib/pdf-inspect";
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
  // Whole-suite disable wins first (unchanged): a disabled suite reports an
  // empty green and never surfaces selector errors.
  if (ctx.config.validate.enabled === false) {
    return emptyReport();
  }

  // Resolve only/skip selectors + drop manifest-disabled checks via the shared
  // selector (audit E10 — the same sequence tool probing uses, so the two can't
  // drift). Mistyped selectors surface as errors below rather than silently
  // resolving to nothing and reporting a false "PASSED".
  const { checks: selected, unmatched: unmatchedSelectors } = selectChecks(opts, ctx.config);
  let checks = selected;

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

  // Retain the shared parsed-PDF cache for this run's duration. runChecks is
  // a public lib export served by a long-lived host (the viewer), where runs
  // CAN overlap (a Problems-panel lint run + a publish preflight) — an
  // unconditional clear here would destroy documents a concurrent run is
  // mid-read on, making its checks throw "Transport destroyed" on a valid
  // PDF. release() clears only when the LAST active run finishes; for a lone
  // run that is still this run's end — the natural boundary the pdf-inspect
  // docblock prescribes, without which a long-lived host retains
  // DOC_CACHE_MAX parsed documents indefinitely.
  const release = retainPdfCache();
  try {
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
  } finally {
    release();
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
