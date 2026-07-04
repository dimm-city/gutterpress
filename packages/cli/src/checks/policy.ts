import type { Check, CheckResult } from "./types";
import type { ResolvedConfig } from "../schema/manifest.types";

/**
 * Machine-readable `code` marking a result produced by an inspection / tool
 * FAILURE (we could not parse or probe the artifact) — as opposed to a genuine
 * content violation. The report layer can branch on this without parsing prose.
 */
export const INSPECT_FAILED_CODE = "inspect-failed";

/**
 * The single source of truth for whether a check runs under a given config.
 * Used by BOTH the runner (execution) and tool-check (tool probing) so the two
 * can never drift.
 *
 * Order: an explicit manifest disable wins first, then the check's own
 * declarative `enabledWhen(config)` predicate — the canonical, per-check way to
 * express a tool-specific config gate (e.g. `source.stylelint === false`)
 * instead of hard-coding special cases in the runner/tool-check.
 */
export function isCheckEnabled(check: Check, config: ResolvedConfig): boolean {
  const entry = config.validate.checks[check.id];
  if (entry === false) return false;
  if (typeof entry === "object" && entry.enabled === false) return false;
  if (check.enabledWhen && !check.enabledWhen(config)) return false;
  return true;
}

/**
 * Build a genuine finding, injecting the check id. Severity/message/etc. are the
 * caller's configured values — this represents a real content violation, so its
 * severity is honoured (and can be overridden by the manifest).
 */
export function finding(
  checkId: string,
  init: Omit<CheckResult, "checkId">
): CheckResult {
  return { checkId, ...init };
}

/**
 * Build the result for an inspection / tool FAILURE — a missing tool, an
 * unreadable file, or malformed inspector output. Policy: always a single
 * `warning` tagged `code: "inspect-failed"`, never a hard `error` and never
 * silently dropped, so a transient failure is neither invisible nor
 * build-breaking. Use `finding()` for genuine violations instead.
 */
export function inspectionFailed(
  checkId: string,
  message: string,
  extra: {
    file?: string;
    line?: number;
    detail?: string;
    data?: Record<string, unknown>;
  } = {}
): CheckResult {
  return {
    checkId,
    severity: "warning",
    code: INSPECT_FAILED_CODE,
    message,
    ...extra,
  };
}
