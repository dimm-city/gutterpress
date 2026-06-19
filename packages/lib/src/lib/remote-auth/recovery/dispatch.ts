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
import { resolveLogger } from "../operation-log.ts";

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
  const logger = resolveLogger(ctx.logFile, "recovery");
  const errCode = (error as { code?: string })?.code;
  logger.info("dispatch", `dispatching recovery`, {
    kind,
    repo: ctx.repoSlug,
    branch: ctx.branch,
    ...(errCode ? { errCode } : {}),
  });

  let result: RecoveryResult;
  switch (kind) {
    case "non_fast_forward":
      result = await recoverNonFastForward(ctx, error);
      break;
    case "merge_conflict":
      result = await recoverMergeConflict(ctx, error);
      break;
    case "binary_conflict":
      result = await recoverBinaryConflict(ctx, error);
      break;
    case "auth_required":
      result = await recoverAuth(ctx, error);
      break;
    case "network_unavailable":
      result = await recoverNetwork(ctx, error);
      break;
    case "detached_head":
      result = await recoverDetachedHead(ctx, error);
      break;
    case "stale_lock":
      result = await recoverStaleLock(ctx, error);
      break;
    case "corrupt_index":
      result = await recoverCorruptIndex(ctx, error);
      break;
    case "missing_git_dir":
      result = await recoverMissingGitDir(ctx, error);
      break;
    case "missing_or_corrupt_objects":
      result = await recoverMissingObjects(ctx, error);
      break;
    case "unrelated_histories":
      result = await recoverUnrelatedHistories(ctx, error);
      break;
    case "wrong_remote_or_branch":
      result = await recoverWrongRemote(ctx, error);
      break;
    case "unknown":
      result = await recoverUnknown(ctx, error);
      break;
  }

  logger.info("dispatch", `recovery complete`, {
    kind,
    result: result.status,
  });
  return result;
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
