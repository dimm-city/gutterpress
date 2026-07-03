/**
 * recover-binary-conflict.ts — never auto-merge binary files.
 *
 * WHY this exists: binary files (images, PDFs, audio, etc.) cannot be
 * line-merged. When both the local copy and the online copy changed the same
 * binary file, the only honest answer is: show the user the list of clashing
 * files and let them choose which version to keep. The "Keep both" option
 * works for binary files too — it keeps the author's version alongside an
 * "(online copy)" rename.
 *
 * This handler is intentionally identical in shape to recover-merge-conflict.ts.
 * The distinction between text and binary conflicts is made at a higher level
 * (classify.ts / the merge engine) — by the time recover() is called we already
 * know the conflict involves binary content, so we surface it the same way:
 * a 'needs_user' result with the conflicted file list.
 *
 * Reuses:
 *   pullChanges  — snapshot → fetch → merge (abortOnConflict). On a binary
 *                  file isomorphic-git still throws MergeConflictError with the
 *                  conflicting filepath in data.filepaths.
 *   makeManualGuidance — jargon-free copy for binary_conflict.
 *
 * Policy (policy.ts): createBackup=false, requireConfirmation=false.
 *   The working tree is left completely untouched by pullChanges
 *   (abortOnConflict), so no backup is needed to surface the conflict to the
 *   user. The confirmation gate is the per-file UI chooser, not withBackupGate.
 *
 * Safety invariants (see test file):
 *   - NO force-push: pullChanges never pushes; this handler never calls push.
 *   - Remote HEAD is NEVER advanced: we stop at conflict, surface needs_user.
 *   - Both blob versions are preserved in local history (pullChanges snapshots
 *     the working tree before merge, then aborts — no side is silently dropped).
 *   - write_conflict_snapshot fault hook is called and, if it throws, the error
 *     is caught and a safe fallback is returned (no unhandled throw to caller).
 */

import { pullChanges } from "../sync.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { mapOutcomeToResult, syncOptionsFrom } from "./outcome-mapping.ts";
import type { RecoverFn, RecoveryResult } from "./types.ts";

/** Jargon-free copy shown when both copies changed the same un-mergeable file. */
const BINARY_CONFLICT_MESSAGE =
  "Your copy and the online copy both changed files that can't be combined automatically. Choose which version to keep for each file.";

export const recover: RecoverFn = async (ctx, _error): Promise<RecoveryResult> => {
  // Pull without pushing — detects the binary conflict without touching remote.
  let pullOutcome;
  try {
    pullOutcome = await pullChanges(syncOptionsFrom(ctx));
  } catch (e) {
    // Unexpected throw from pullChanges — fail safe, no changes made.
    return {
      status: "failed_no_changes_made",
      message:
        "Something went wrong while checking for online changes. Nothing was changed.",
      guidance: makeManualGuidance(ctx, "binary_conflict", e),
    };
  }

  // Fire the fault hook if provided (lets tests inject a failure at the
  // write_conflict_snapshot point). If it throws we swallow it here and still
  // surface the conflict below — the file list is already known from the pull
  // outcome, so the caller can show the chooser regardless.
  if (pullOutcome.status === "conflict") {
    try {
      await ctx.faults?.before("write_conflict_snapshot");
    } catch {
      // Fault injected — proceed to the same needs_user result (no snapshot).
    }
  }

  // Default map handles pulled/up-to-date → recovered, auth → needs_user
  // (auth_required), and offline → retry_later (30 s). This handler
  // intentionally differs on:
  //   - conflict: binary_conflict guidance + custom copy, threading the tip
  //               OIDs through so the caller can invoke resolveConflicts.
  //   - error:    failed_no_changes_made with binary_conflict guidance (not the
  //               generic unknown copy) — no repair was run, nothing changed.
  return mapOutcomeToResult(ctx, pullOutcome, {
    conflict: (c, o) => {
      const conflict = o as Extract<typeof pullOutcome, { status: "conflict" }>;
      return {
        status: "needs_user",
        message: BINARY_CONFLICT_MESSAGE,
        guidance: makeManualGuidance(c, "binary_conflict"),
        files: conflict.files,
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      };
    },
    error: (c, o) => ({
      status: "failed_no_changes_made",
      message: o.message,
      guidance: makeManualGuidance(c, "binary_conflict"),
    }),
  });
};
