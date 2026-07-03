/**
 * recover-network.ts — Offline: keep local work, schedule retry.
 *
 * WHY this module exists: when print-md can't reach the server (ECONNREFUSED,
 * ETIMEDOUT, or any other network error), the right behavior is:
 *
 *   1. Snapshot any unsaved work locally so nothing is lost (sync.ts already
 *      does this as its first step — "snapshot-first" invariant from ADR 0006 D5).
 *   2. Tell the host to retry later with an exponential backoff delay.
 *   3. Do NOT create a backup zip (risk is "none" — no data is at risk).
 *   4. Do NOT ask the user for confirmation (no repair is being attempted).
 *   5. Do NOT force-push, do NOT touch the remote.
 *
 * This is a THIN WRAPPER around syncProject from sync.ts. The snapshot step,
 * the network call, and the "offline" classification all live there. The only
 * delta this module adds is translating SyncOutcome { status: "offline" } →
 * RecoveryResult { status: "retry_later", retryAfterMs }.
 *
 * Backoff: fixed 30 s delay before the next automated retry.
 */

import { RETRY_AFTER_MS, mapOutcomeToResult, syncOptionsFrom } from "./outcome-mapping.ts";
import { syncProject } from "../sync.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

// ── RecoverFn implementation ─────────────────────────────────────────────────

/**
 * Handle a `network_unavailable` classification:
 *
 * - Delegates entirely to `syncProject` (which snapshots unsaved work first,
 *   then attempts fetch + merge + push through the injectable httpClient).
 * - When the outcome is `offline`, returns `retry_later` with a sane backoff.
 * - When the outcome is anything else (e.g. the network recovered mid-call),
 *   passes the outcome through as a `recovered` result so the host can refresh.
 *
 * The `error` argument is accepted per the dispatcher contract but is not
 * needed here: syncProject already re-classifies the live error internally.
 */
export async function recover(
  ctx: RecoveryContext,
  _error?: unknown,
): Promise<RecoveryResult> {
  const outcome = await syncProject(syncOptionsFrom(ctx));

  // Default map handles synced/up-to-date → recovered and conflict →
  // needs_user (merge_conflict — retrying cannot fix a conflict, so surface it
  // NOW with the file list rather than burning a retry cycle). This handler
  // intentionally differs on:
  //   - offline: retry_later with soft "we'll try again shortly" copy.
  //   - auth:    retry_later (not needs_user) so the caller routes to the auth
  //              recovery handler on the next pass.
  //   - error:   retry_later fallback (not failed_no_changes_made) so the host
  //              retries through the full dispatcher next time rather than
  //              silently dropping the failure.
  return mapOutcomeToResult(ctx, outcome, {
    offline: () => ({
      status: "retry_later",
      message:
        "Your work is saved on this computer. We'll try sending it online again shortly.",
      retryAfterMs: RETRY_AFTER_MS,
    }),
    auth: (_c, o) => ({
      status: "retry_later",
      message: o.message,
      retryAfterMs: RETRY_AFTER_MS,
    }),
    error: () => ({
      status: "retry_later",
      message:
        "Your work is saved on this computer. Sync will be retried shortly.",
      retryAfterMs: RETRY_AFTER_MS,
    }),
  });
}
