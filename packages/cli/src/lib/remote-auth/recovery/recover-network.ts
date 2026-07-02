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

import { makeManualGuidance } from "./manual-guidance.ts";
import { syncProject } from "../sync.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

/** Delay before the next automated retry (30 seconds). */
const RETRY_AFTER_MS = 30_000;

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
  const outcome = await syncProject({
    projectDir: ctx.projectDir,
    credential: ctx.credential,
    tokenStore: ctx.tokenStore,
    authorName: ctx.authorName,
    httpClient: ctx.httpClient,
  });

  switch (outcome.status) {
    case "offline":
      return {
        status: "retry_later",
        message:
          "Your work is saved on this computer. We'll try sending it online again shortly.",
        retryAfterMs: RETRY_AFTER_MS,
      };

    case "synced":
      return {
        status: "recovered",
        message: outcome.message,
      };

    case "up-to-date":
      // Network was reachable; nothing to push. Still counts as "recovered"
      // (no pending work was lost and the connection is healthy).
      return {
        status: "recovered",
        message: outcome.message,
      };

    case "auth":
      // The network came back but credentials are wrong — surface retry_later
      // so the caller can route to the auth recovery handler on the next pass.
      return {
        status: "retry_later",
        message: outcome.message,
        retryAfterMs: RETRY_AFTER_MS,
      };

    case "conflict":
      // The network came back and the retry immediately hit a real merge
      // conflict. Retrying cannot fix a conflict — surface it to the user NOW
      // with the file list (mirrors recover-merge-conflict.ts) instead of
      // burning a retry cycle telling the author "we'll try again shortly"
      // about a condition that needs their decision.
      return {
        status: "needs_user",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "merge_conflict"),
        files: outcome.files,
      };

    default:
      // pull-first / error — these need a different recovery path (not
      // network_unavailable). Return retry_later as a safe fallback so the
      // host retries through the full dispatcher next time rather than
      // silently dropping the failure.
      return {
        status: "retry_later",
        message:
          "Your work is saved on this computer. Sync will be retried shortly.",
        retryAfterMs: RETRY_AFTER_MS,
      };
  }
}
