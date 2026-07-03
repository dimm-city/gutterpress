/**
 * Recovery handler for merge_conflict — thin wrapper over pullChanges.
 *
 * WHY a thin wrapper: merge_conflict is NOT a broken repo. The working tree is
 * always left clean by pullChanges (abortOnConflict keeps the tree at the
 * pre-merge snapshot). This handler's only job is to translate a
 * `{ status: "conflict" }` PullOutcome into a `{ status: "needs_user" }`
 * RecoveryResult so the host can show the per-file version chooser.
 *
 * No merge logic is re-implemented here. All the snapshot-first invariant,
 * conflict detection, and two-parent merge machinery lives in sync.ts.
 *
 * SAFETY PROPERTIES (tested in recover-merge-conflict.test.ts):
 *   1. Result is 'needs_user' with ConflictFile[] attached.
 *   2. Working file NEVER contains '<<<<<<<' or '>>>>>>>' markers.
 *   3. Remote HEAD + tree UNCHANGED after recover() returns.
 *   4. User-visible local files preserved (snapshot kept both copies).
 *   5. No force-push is attempted (policy mayChangeRemote=false).
 *   6. Confirmation gate is NEVER called (requireConfirmation=false).
 *   7. No backup zip created (createBackup=false — risk is "none").
 *
 * Policy: merge_conflict has risk="none", createBackup=false,
 * requireConfirmation=false. The repair is fully safe and reversible via the
 * snapshot pullChanges takes before attempting the merge.
 */

import { pullChanges } from "../sync.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { mapOutcomeToResult, syncOptionsFrom } from "./outcome-mapping.ts";
import type { RecoverFn, RecoveryResult } from "./types.ts";

/**
 * Translate a sync.ts PullOutcome into a RecoveryResult.
 *
 * - conflict  → needs_user (the intended outcome: surface the per-file chooser)
 * - pulled / up-to-date → recovered (the pull succeeded; no conflict after all)
 * - auth / offline / error → needs_user with guidance (pass the guidance through)
 */
export const recover: RecoverFn = async (ctx, _error?): Promise<RecoveryResult> => {
  const outcome = await pullChanges(syncOptionsFrom(ctx));

  // Default map handles conflict → needs_user with merge_conflict guidance +
  // files (the intended outcome: surface the per-file chooser; no backupZipPath
  // — pullChanges left a snapshot commit as the D5 safety net). This handler
  // intentionally differs on:
  //   - pulled / up-to-date: friendly fixed copy (not outcome.message).
  //   - offline: needs_user with network guidance (not retry_later) — the
  //              conflict path never silently schedules a retry.
  //   - error:   needs_user with unknown guidance (not failed_no_changes_made).
  return mapOutcomeToResult(ctx, outcome, {
    pulled: () => ({
      status: "recovered",
      message: "The latest online changes were downloaded to this computer.",
    }),
    "up-to-date": () => ({
      status: "recovered",
      message: "Everything is already in sync.",
    }),
    offline: (c, o) => ({
      status: "needs_user",
      message: o.message,
      guidance: makeManualGuidance(c, "network_unavailable"),
    }),
    error: (c, o) => ({
      status: "needs_user",
      message: o.message,
      guidance: makeManualGuidance(c, "unknown"),
    }),
  });
};
