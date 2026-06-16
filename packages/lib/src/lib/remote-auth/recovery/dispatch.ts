/**
 * Recovery dispatcher — INTEGRATE PHASE.
 *
 * Maps each SyncErrorKind to its recover-<x>.ts handler.
 * Also exports the index barrel for the recovery subsystem public surface.
 *
 * The dispatcher is the single call-site for all recovery attempts. Callers
 * (e.g. a guardedSync wrapper) obtain a SyncErrorKind from classifyGitError(),
 * build a RecoveryContext, and call recover(kind, ctx, error).
 *
 * Handler lookup is a plain switch — no dynamic import, no registry object —
 * so TypeScript can verify exhaustiveness at compile time and bun build
 * --compile can tree-shake unused handlers.
 */

import type { RecoveryContext, RecoveryResult, SyncErrorKind } from "./types.ts";

// ── Handler imports ───────────────────────────────────────────────────────────

import { recover as recoverNonFastForward } from "./recover-non-fast-forward.ts";
import { recover as recoverMergeConflict } from "./recover-merge-conflict.ts";
import { recover as recoverBinaryConflict } from "./recover-binary-conflict.ts";
import { recover as recoverAuth } from "./recover-auth.ts";
import { recover as recoverNetwork } from "./recover-network.ts";
import { recover as recoverDetachedHead } from "./recover-detached-head.ts";
import { recover as recoverStaleLock } from "./recover-stale-lock.ts";
import { recover as recoverCorruptIndex } from "./recover-corrupt-index.ts";
import { recover as recoverMissingGitDir } from "./recover-missing-git-dir.ts";
import { recover as recoverMissingObjects } from "./recover-missing-objects.ts";
import { recover as recoverUnrelatedHistories } from "./recover-unrelated-histories.ts";
import { recover as recoverWrongRemote } from "./recover-wrong-remote.ts";

// ── Unknown-kind fallback ─────────────────────────────────────────────────────

import { failSafeNoRepair } from "./failsafe.ts";
import { makeManualGuidance } from "./manual-guidance.ts";

/**
 * Fallback for the 'unknown' kind — no repair is attempted.
 * Returns failed_no_changes_made with generic guidance so the host can show
 * something useful even if the error can't be classified.
 */
async function recoverUnknown(
  ctx: RecoveryContext,
  error?: unknown,
): Promise<RecoveryResult> {
  return failSafeNoRepair(ctx, "unknown", undefined, error);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Dispatch a recovery attempt.
 *
 * @param kind   - The SyncErrorKind from classifyGitError().
 * @param ctx    - Full RecoveryContext (repoDir, branch, remoteUrl, etc.).
 * @param error  - The original thrown error, if available.
 * @returns      RecoveryResult describing what happened.
 */
export async function recover(
  kind: SyncErrorKind,
  ctx: RecoveryContext,
  error?: unknown,
): Promise<RecoveryResult> {
  switch (kind) {
    case "non_fast_forward":
      return recoverNonFastForward(ctx, error);
    case "merge_conflict":
      return recoverMergeConflict(ctx, error);
    case "binary_conflict":
      return recoverBinaryConflict(ctx, error);
    case "auth_required":
      return recoverAuth(ctx, error);
    case "network_unavailable":
      return recoverNetwork(ctx, error);
    case "detached_head":
      return recoverDetachedHead(ctx, error);
    case "stale_lock":
      return recoverStaleLock(ctx, error);
    case "corrupt_index":
      return recoverCorruptIndex(ctx, error);
    case "missing_git_dir":
      return recoverMissingGitDir(ctx, error);
    case "missing_or_corrupt_objects":
      return recoverMissingObjects(ctx, error);
    case "unrelated_histories":
      return recoverUnrelatedHistories(ctx, error);
    case "wrong_remote_or_branch":
      return recoverWrongRemote(ctx, error);
    case "unknown":
      return recoverUnknown(ctx, error);
  }
}

// ── Re-export the public type surface ────────────────────────────────────────

export type {
  RecoverFn,
  RecoveryContext,
  RecoveryResult,
  SyncErrorKind,
  RecoveryRisk,
  ManualGuidance,
  RepoHealth,
  RecoveryBackup,
  RepairConfirmation,
  ConfirmationGate,
  FaultInjector,
  FaultPoint,
} from "./types.ts";

export { classifyGitError } from "./classify.ts";
export { inspectRepo } from "./inspect.ts";
export { recoveryPolicy, policyFor, detachedHeadWithLocalChangesPolicy } from "./policy.ts";
export { createRecoveryZip, assertZipReadable, zipEntries } from "./backup.ts";
export { makeManualGuidance } from "./manual-guidance.ts";
export { failSafeNoRepair, withBackupGate } from "./failsafe.ts";
