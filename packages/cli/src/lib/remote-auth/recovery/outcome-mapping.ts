/**
 * outcome-mapping.ts — shared SyncOutcome/PullOutcome → RecoveryResult mapping.
 *
 * WHY this exists: five thin recovery handlers (recover-non-fast-forward,
 * recover-auth, recover-network, recover-merge-conflict, recover-binary-conflict)
 * all build the SAME syncProject/pullChanges options object from the context and
 * then translate the typed outcome union into a RecoveryResult. The option
 * object was copied verbatim five times, and the outcome→result maps had drifted
 * apart (e.g. an `offline` outcome mapped to `retry_later` in one handler and to
 * `needs_user` in another). This module owns the ONE default map; each handler
 * passes only the per-status `overrides` where its behavior INTENTIONALLY
 * differs, so the disagreements are explicit rather than accidental copies.
 *
 * DEFAULT OUTCOME MAP (what a handler gets with no overrides):
 *   synced       → recovered              { message: outcome.message }
 *   pulled       → recovered              { message: outcome.message }
 *   up-to-date   → recovered              { message: outcome.message }
 *   conflict     → needs_user             { message, guidance: merge_conflict, files }
 *   auth         → needs_user             { message, guidance: auth_required }
 *   offline      → retry_later            { message, retryAfterMs: RETRY_AFTER_MS }
 *   error /      → failed_no_changes_made { message, guidance: unknown }
 *   (unknown)
 *
 * An override wins over the default for its status. An UNKNOWN/future status
 * routes to the `error` builder (override first, then default) — mirroring the
 * `default:` arm every handler used to carry.
 */

import { makeManualGuidance } from "./manual-guidance.ts";
import type { PullOutcome, SyncOutcome } from "../sync.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

/** Fixed delay before the next automated retry (30 seconds). */
export const RETRY_AFTER_MS = 30_000;

/** The typed outcome unions the recovery handlers translate. */
export type AnyOutcome = SyncOutcome | PullOutcome;

/** Every status either outcome union can carry. */
export type OutcomeStatus = AnyOutcome["status"];

/** The conflict arm (from either union) — carries files + tip OIDs. */
type ConflictOutcome = Extract<AnyOutcome, { status: "conflict" }>;

/** Builds a RecoveryResult from the context and the (already-classified) outcome. */
export type OutcomeBuilder = (ctx: RecoveryContext, outcome: AnyOutcome) => RecoveryResult;

/** Per-status overrides a handler supplies where it intentionally differs. */
export type OutcomeOverrides = Partial<Record<OutcomeStatus, OutcomeBuilder>>;

/**
 * The shared options object every handler feeds to syncProject / pullChanges.
 * Extracted so the five copies can never drift.
 */
export function syncOptionsFrom(ctx: RecoveryContext) {
  return {
    projectDir: ctx.projectDir,
    credential: ctx.credential,
    tokenStore: ctx.tokenStore,
    authorName: ctx.authorName,
    httpClient: ctx.httpClient,
  };
}

const recovered: OutcomeBuilder = (_ctx, outcome) => ({
  status: "recovered",
  message: outcome.message,
});

/** The default outcome→result map (see the header for the documented contract). */
const DEFAULT_OUTCOME_MAP: Record<OutcomeStatus, OutcomeBuilder> = {
  synced: recovered,
  pulled: recovered,
  "up-to-date": recovered,
  conflict: (ctx, outcome) => {
    const c = outcome as ConflictOutcome;
    return {
      status: "needs_user",
      message: c.message,
      guidance: makeManualGuidance(ctx, "merge_conflict"),
      files: c.files,
    };
  },
  auth: (ctx, outcome) => ({
    status: "needs_user",
    message: outcome.message,
    guidance: makeManualGuidance(ctx, "auth_required"),
  }),
  offline: (_ctx, outcome) => ({
    status: "retry_later",
    message: outcome.message,
    retryAfterMs: RETRY_AFTER_MS,
  }),
  error: (ctx, outcome) => ({
    status: "failed_no_changes_made",
    message: outcome.message,
    guidance: makeManualGuidance(ctx, "unknown"),
  }),
};

/**
 * Translate a SyncOutcome/PullOutcome into a RecoveryResult using the default
 * map, letting per-status `overrides` win. Any status not present in the map
 * (a future/unknown status) falls through to the `error` builder — override
 * first, then default — matching each handler's original `default:` arm.
 */
export function mapOutcomeToResult(
  ctx: RecoveryContext,
  outcome: AnyOutcome,
  overrides: OutcomeOverrides = {},
): RecoveryResult {
  const status = outcome.status;
  const builder =
    overrides[status] ??
    DEFAULT_OUTCOME_MAP[status] ??
    overrides.error ??
    DEFAULT_OUTCOME_MAP.error;
  return builder(ctx, outcome);
}
