/**
 * recover-stale-lock.ts — remove a stale .git/index.lock file.
 *
 * WHY: When a write operation is interrupted (power loss, forced kill, crash)
 * the version-tracking system leaves a lock file behind. Every subsequent
 * operation fails until the lock is removed. This handler automates that
 * cleanup with a conservative age check and a user confirmation gate.
 *
 * Decision logic:
 *   FRESH lock (age < STALE_THRESHOLD_MS) → someone else may still hold it;
 *     return retry_later so the caller can check again shortly.
 *   NO lock at all → the race was already won; return retry_later (safe to
 *     retry the original operation immediately).
 *   STALE lock (age ≥ STALE_THRESHOLD_MS) → request user confirmation, then
 *     delete; return recovered.
 *
 * Safety invariants:
 *   - Never force-pushes (this repair is entirely local).
 *   - No backup zip (policy.createBackup = false for stale_lock; a lock file
 *     is trivially recreatable and contains no user data).
 *   - Confirmation required (policy.requireConfirmation = true).
 *   - Fault hook ctx.faults?.before("remove_index_lock") fires just before
 *     the unlink so tests can assert the fail-safe path.
 *   - User content files are never touched.
 *
 * Author-facing copy lives in manual-guidance.ts (stale_lock case). No git
 * words, no file paths, no tokens in any user-visible string.
 */

import * as fs from "node:fs";
import { unlink, stat } from "node:fs/promises";
import path from "node:path";

import { gitDirFor } from "../../source-provider.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { policyFor } from "./policy.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * A lock younger than this is considered "fresh" — another process may still
 * hold it. 2 minutes is the conservative safe minimum (most git operations
 * complete in under 10 seconds; 2 min gives a wide margin for slow machines).
 */
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * How long the caller should wait before retrying when the lock is fresh.
 * We suggest retrying after the remaining time until the lock would be stale.
 */
const RETRY_AFTER_MS = STALE_THRESHOLD_MS; // retry after the full threshold

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Attempt to recover from a stale .git/index.lock file.
 *
 * Implements the RecoverFn contract from types.ts.
 */
export async function recover(
  ctx: RecoveryContext,
  _error?: unknown,
): Promise<RecoveryResult> {
  const kind = "stale_lock" as const;
  const policy = policyFor(kind);
  const now = ctx.now ? ctx.now() : Date.now();
  const lockPath = path.join(gitDirFor(ctx.repoDir), "index.lock");

  // ── Check whether the lock exists and how old it is ───────────────────────

  let lockAgeMs: number | undefined;

  try {
    const lockStat = await stat(lockPath);
    lockAgeMs = now - lockStat.mtimeMs;
  } catch {
    // Lock file does not exist (or is not accessible). The other process may
    // have already removed it — treat as a fresh disappearance: safe to retry.
    return {
      status: "retry_later",
      message:
        "The temporary lock is no longer there. You can try again right away.",
      retryAfterMs: 0,
    };
  }

  // ── Fresh lock: another process may still hold it ─────────────────────────

  if (lockAgeMs < STALE_THRESHOLD_MS) {
    const remaining = STALE_THRESHOLD_MS - lockAgeMs;
    return {
      status: "retry_later",
      message:
        "Another operation is in progress. Try again in a moment.",
      retryAfterMs: remaining,
    };
  }

  // ── Stale lock: ask the user before removing ──────────────────────────────

  if (policy.requireConfirmation) {
    const guidance = makeManualGuidance(ctx, kind, undefined, undefined);
    const approved = await ctx.confirmation.confirmRepair({
      repair: kind,
      risk: policy.risk,
      summary: guidance.recommendedNextStep,
      backupZipPath: "", // no backup for stale_lock
      willChangeLocalFiles: policy.mayChangeLocalFiles,
      willChangeGitMetadata: policy.mayChangeGitMetadata,
      willChangeRemote: policy.mayChangeRemote,
      canBeUndoneFromBackup: false,
    });

    if (!approved) {
      const blockedGuidance = makeManualGuidance(ctx, kind, undefined, undefined);
      return {
        status: "blocked",
        message: "The repair was cancelled. Nothing was changed.",
        guidance: blockedGuidance,
        // No backupZipPath — policy.createBackup is false.
      };
    }
  }

  // ── Remove the lock file ──────────────────────────────────────────────────

  try {
    await ctx.faults?.before("remove_index_lock");
    await unlink(lockPath);
  } catch (removeErr) {
    // Removal failed (fault injection or real error). No backup was created
    // (createBackup=false), so we return failed_no_changes_made.
    const guidance = makeManualGuidance(ctx, kind, removeErr, undefined);
    return {
      status: "failed_no_changes_made",
      message: guidance.userSummary,
      guidance,
    };
  }

  // Verify the lock is gone (defensive — unlink should have thrown on failure)
  const lockGone = !fs.existsSync(lockPath);
  if (!lockGone) {
    const guidance = makeManualGuidance(ctx, kind, new Error("lock file still present after removal"), undefined);
    return {
      status: "failed_no_changes_made",
      message: guidance.userSummary,
      guidance,
    };
  }

  return {
    status: "recovered",
    message:
      "The leftover lock was removed. You can try syncing again.",
    // No backupZipPath — policy.createBackup is false.
  };
}
