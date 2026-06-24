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
import type { RecoverFn, RecoveryResult } from "./types.ts";

export const recover: RecoverFn = async (ctx, _error): Promise<RecoveryResult> => {
  // Pull without pushing — detects the binary conflict without touching remote.
  let pullOutcome;
  try {
    pullOutcome = await pullChanges({
      projectDir: ctx.projectDir,
      credential: ctx.credential,
      tokenStore: ctx.tokenStore,
      authorName: ctx.authorName,
      httpClient: ctx.httpClient,
    });
  } catch (e) {
    // Unexpected throw from pullChanges — fail safe, no changes made.
    return {
      status: "failed_no_changes_made",
      message:
        "Something went wrong while checking for online changes. Nothing was changed.",
      guidance: makeManualGuidance(ctx, "binary_conflict", e),
    };
  }

  switch (pullOutcome.status) {
    case "conflict": {
      // Conflict detected — surface to the user for manual choice.
      // Thread localId and remoteId through so the caller can invoke
      // resolveConflicts with the correct OIDs after the user decides.
      const guidance = makeManualGuidance(ctx, "binary_conflict");

      // Fire the fault hook if provided (allows test to inject failures
      // at the write_conflict_snapshot point). If it throws we catch it
      // below and return a safe fallback rather than propagating.
      try {
        await ctx.faults?.before("write_conflict_snapshot");
      } catch (faultErr) {
        // Fault injected — return needs_user without the snapshot write.
        // The file list is already known from the pull outcome; we still
        // surface it so the caller can show the UI (just without snapshot).
        return {
          status: "needs_user",
          message:
            "Your copy and the online copy both changed files that can't be combined automatically. Choose which version to keep for each file.",
          guidance,
          files: pullOutcome.files,
          // Thread OIDs for resolveConflicts (typed as extra fields beyond RecoveryResult).
          ...({ localId: pullOutcome.localId, remoteId: pullOutcome.remoteId } as Record<string, string>),
        } as RecoveryResult & { localId: string; remoteId: string };
      }

      return {
        status: "needs_user",
        message:
          "Your copy and the online copy both changed files that can't be combined automatically. Choose which version to keep for each file.",
        guidance,
        files: pullOutcome.files,
        // Thread localId/remoteId through so the caller can invoke resolveConflicts.
        ...({ localId: pullOutcome.localId, remoteId: pullOutcome.remoteId } as Record<string, string>),
      } as RecoveryResult & { localId: string; remoteId: string };
    }

    case "pulled":
    case "up-to-date":
      // No conflict after all — the pull succeeded cleanly.
      return {
        status: "recovered",
        message: pullOutcome.message,
      };

    case "auth":
      return {
        status: "needs_user",
        message: pullOutcome.message,
        guidance: makeManualGuidance(ctx, "auth_required"),
      };

    case "offline":
      return {
        status: "retry_later",
        message: pullOutcome.message,
        retryAfterMs: 30_000,
      };

    default:
      // 'error' or any future status: no repair was run, nothing changed.
      return {
        status: "failed_no_changes_made",
        message: pullOutcome.message,
        guidance: makeManualGuidance(ctx, "binary_conflict"),
      };
  }
};
