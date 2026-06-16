/**
 * Fail-safe wrapper and no-op fallback for the sync-recovery subsystem.
 *
 * withBackupGate() enforces the invariant ordering every risky repair must
 * follow:
 *   1. Look up the policy for the kind.
 *   2. If createBackup → createRecoveryZip; on failure → failSafe
 *      "failed_no_changes_made" with NO subsequent writes.
 *   3. If requireConfirmation → confirmRepair; DENIED → "blocked" no-op.
 *   4. Run the risky repair callback.
 *   5. If the risky callback throws AFTER a backup → failSafe
 *      "failed_backup_available" (backup is readable, remote is unchanged).
 *
 * failSafeNoRepair() is the terminal no-op: returns
 *   - "failed_backup_available" when a backup zip path is supplied
 *   - "failed_no_changes_made" otherwise
 * Both branches include ManualGuidance so the host can show useful copy.
 */

import { createRecoveryZip } from "./backup.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { policyFor } from "./policy.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  SyncErrorKind,
} from "./types.ts";

/**
 * Terminal no-op: no repair was attempted (or the repair failed after a
 * backup was created). Returns a RecoveryResult with the appropriate status.
 */
export function failSafeNoRepair(
  ctx: Pick<RecoveryContext, "repoSlug" | "remoteUrl">,
  kind: SyncErrorKind,
  backupZipPath?: string,
  error?: unknown,
): RecoveryResult {
  const guidance = makeManualGuidance(ctx, kind, error, backupZipPath);
  if (backupZipPath) {
    return {
      status: "failed_backup_available",
      message: guidance.userSummary,
      backupZipPath,
      guidance,
    };
  }
  return {
    status: "failed_no_changes_made",
    message: guidance.userSummary,
    guidance,
  };
}

/**
 * Enforce the invariant ordering for risky repairs:
 *   policy → backup → confirmation → risky → failsafe on throw.
 *
 * The `risky` callback receives the backup zip path (or undefined) and
 * must call ctx.faults?.before("after_backup_before_repair") at the start
 * of its destructive section.
 */
export async function withBackupGate(
  ctx: RecoveryContext,
  kind: SyncErrorKind,
  risky: (backupZipPath: string | undefined) => Promise<RecoveryResult>,
  error?: unknown,
): Promise<RecoveryResult> {
  const policy = policyFor(kind);
  let backupZipPath: string | undefined;

  // ── Step 1: create backup if required ─────────────────────────────────────
  if (policy.createBackup) {
    try {
      const backup = await createRecoveryZip(ctx, kind);
      backupZipPath = backup.zipPath;
    } catch (backupErr) {
      // Backup failed — fail safe with NO subsequent writes.
      return failSafeNoRepair(ctx, kind, undefined, backupErr);
    }
  }

  // ── Step 2: require confirmation if policy demands it ──────────────────────
  if (policy.requireConfirmation) {
    const guidance = makeManualGuidance(ctx, kind, error, backupZipPath);
    const approved = await ctx.confirmation.confirmRepair({
      repair: kind,
      risk: policy.risk,
      summary: guidance.recommendedNextStep,
      backupZipPath: backupZipPath ?? "",
      willChangeLocalFiles: policy.mayChangeLocalFiles,
      willChangeGitMetadata: policy.mayChangeGitMetadata,
      willChangeRemote: policy.mayChangeRemote,
      canBeUndoneFromBackup: !!backupZipPath,
    });
    if (!approved) {
      const blockedGuidance = makeManualGuidance(ctx, kind, error, backupZipPath);
      return {
        status: "blocked",
        message: "The repair was cancelled. Nothing was changed.",
        guidance: blockedGuidance,
        ...(backupZipPath ? { backupZipPath } : {}),
      };
    }
  }

  // ── Step 3: run the risky repair ────────────────────────────────────────────
  try {
    return await risky(backupZipPath);
  } catch (repairErr) {
    // Repair threw after backup was created.
    return failSafeNoRepair(ctx, kind, backupZipPath, repairErr);
  }
}
