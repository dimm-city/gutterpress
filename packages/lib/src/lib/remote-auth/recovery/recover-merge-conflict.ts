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
import type { RecoverFn, RecoveryResult } from "./types.ts";

/**
 * Translate a sync.ts PullOutcome into a RecoveryResult.
 *
 * - conflict  → needs_user (the intended outcome: surface the per-file chooser)
 * - pulled / up-to-date → recovered (the pull succeeded; no conflict after all)
 * - auth / offline / error → needs_user with guidance (pass the guidance through)
 */
export const recover: RecoverFn = async (ctx, _error?): Promise<RecoveryResult> => {
  const outcome = await pullChanges({
    projectDir: ctx.projectDir,
    credential: ctx.credential,
    tokenStore: ctx.tokenStore,
    authorName: ctx.authorName,
    httpClient: ctx.httpClient,
  });

  switch (outcome.status) {
    case "conflict":
      return {
        status: "needs_user",
        message: outcome.message,
        // Override recommendedAction to the per-file chooser action label
        // expected by the host UI. makeManualGuidance provides the copy;
        // the action label is set to the canonical per-file-version-choice
        // action so the host can route directly to the chooser screen.
        guidance: {
          ...makeManualGuidance(ctx, "merge_conflict"),
          recommendedAction: "choose_file_version",
        },
        files: outcome.files,
        // No backupZipPath — policy createBackup=false; pullChanges left a
        // snapshot commit on the local branch as the safety net (D5 invariant).
      };

    case "pulled":
    case "up-to-date": {
      // The pull resolved cleanly — no conflict was present (or it was a
      // fast-forward). Report recovered so the host can refresh the preview.
      const msg =
        outcome.status === "up-to-date"
          ? "Everything is already in sync."
          : "The latest online changes were downloaded to this computer.";
      return { status: "recovered", message: msg };
    }

    case "auth":
      return {
        status: "needs_user",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "auth_required"),
      };

    case "offline":
      return {
        status: "needs_user",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "network_unavailable"),
      };

    default:
      // "error" and any future arms
      return {
        status: "needs_user",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "unknown"),
      };
  }
};
