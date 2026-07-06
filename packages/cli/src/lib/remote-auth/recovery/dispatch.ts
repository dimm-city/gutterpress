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

import type {
  RecoveryContext,
  RecoveryResult,
  StillAppliesFn,
  SyncErrorKind,
} from "./types.ts";
import { resolveLogger } from "../operation-log.ts";
import { withRepoLock } from "../../source-provider.ts";
import { policyFor } from "./policy.ts";

// ── Handler imports ───────────────────────────────────────────────────────────

import { recover as recoverNonFastForward } from "./recover-non-fast-forward.ts";
import { recover as recoverMergeConflict } from "./recover-merge-conflict.ts";
import { recover as recoverBinaryConflict } from "./recover-binary-conflict.ts";
import { recover as recoverAuth } from "./recover-auth.ts";
import { recover as recoverNetwork } from "./recover-network.ts";
import { recover as recoverDetachedHead, stillApplies as detachedHeadStillApplies } from "./recover-detached-head.ts";
import { recover as recoverStaleLock } from "./recover-stale-lock.ts";
import { recover as recoverCorruptIndex, stillApplies as corruptIndexStillApplies } from "./recover-corrupt-index.ts";
import { recover as recoverMissingGitDir, stillApplies as missingGitDirStillApplies } from "./recover-missing-git-dir.ts";
import { recover as recoverMissingObjects, stillApplies as missingObjectsStillApplies } from "./recover-missing-objects.ts";
import { recover as recoverUnrelatedHistories } from "./recover-unrelated-histories.ts";
import { recover as recoverWrongRemote } from "./recover-wrong-remote.ts";
import { recover as recoverInterruptedRebase, stillApplies as interruptedRebaseStillApplies } from "./recover-interrupted-rebase.ts";
import { recover as recoverInterruptedCherryPick, stillApplies as interruptedCherryPickStillApplies } from "./recover-interrupted-cherry-pick.ts";
import { recover as recoverInterruptedMerge, stillApplies as interruptedMergeStillApplies } from "./recover-interrupted-merge.ts";

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

// ── Consolidated stillApplies preconditions ──────────────────────────────────

/**
 * Per-kind precondition probe + the benign no-op message to use when it
 * reports the condition is already resolved. This table is the single place
 * that used to be a hand-rolled TOCTOU re-check duplicated inside individual
 * handlers (recover-missing-git-dir.ts, abort-interrupted-operation.ts) or
 * absent entirely (recover-detached-head.ts, recover-corrupt-index.ts,
 * recover-missing-objects.ts). Only serializeRepo:true kinds ever consult
 * this table (see the call site below) — serializeRepo:false kinds are thin
 * sync.ts delegates that take their own (non-reentrant) lock internally, so a
 * probe here would deadlock them, same as the handler dispatch itself.
 *
 * Author-facing copy rules apply to every message below: plain language, no
 * git jargon (see manual-guidance.ts's header comment).
 */
const STILL_APPLIES: Partial<
  Record<SyncErrorKind, { probe: StillAppliesFn; message: string }>
> = {
  missing_git_dir: {
    probe: missingGitDirStillApplies,
    message: "Your project's version history was already back in place; no changes were needed.",
  },
  detached_head: {
    probe: detachedHeadStillApplies,
    message: "Your project's version history was already back to normal; no changes were needed.",
  },
  corrupt_index: {
    probe: corruptIndexStillApplies,
    message: "Your project's tracking information was already working; no changes were needed.",
  },
  missing_or_corrupt_objects: {
    probe: missingObjectsStillApplies,
    message: "Your project's saved history was already intact; no changes were needed.",
  },
  interrupted_rebase: {
    probe: interruptedRebaseStillApplies,
    message: "Your project was already back to its last working state; no changes were needed.",
  },
  interrupted_cherry_pick: {
    probe: interruptedCherryPickStillApplies,
    message: "Your project was already back to its last working state; no changes were needed.",
  },
  interrupted_merge: {
    probe: interruptedMergeStillApplies,
    message: "Your project was already back to its last working state; no changes were needed.",
  },
};

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

  // Per-repo serialization is enforced HERE, uniformly, by policy — not left
  // to each handler. serializeRepo:true handlers mutate `.git` with raw git.*/
  // node:fs calls and must never race a concurrent sync/snapshot/restore (all
  // of which queue on the same withRepoLock). serializeRepo:false handlers are
  // thin sync.ts delegates whose internals take the (non-reentrant) lock
  // themselves — wrapping them here would deadlock. Handler bodies must keep
  // calling ONLY raw git.*/node:fs while inside the lock, for the same reason.
  const policy = policyFor(kind);
  const dispatch = async () => {
    // Precondition probe: for serializeRepo:true kinds with a STILL_APPLIES
    // entry, re-check — INSIDE the lock, before the handler body runs — that
    // the condition classifyGitError/classifyFromHealth observed still holds.
    // A probe here can only ever be reached for serializeRepo:true kinds
    // (the table has no entries for the serializeRepo:false delegates), so
    // this never re-enters a lock those delegates already take internally.
    const precondition = policy.serializeRepo ? STILL_APPLIES[kind] : undefined;
    if (precondition) {
      const applies = await precondition.probe(ctx);
      if (!applies) {
        logger.info("dispatch", "precondition already resolved — benign no-op", { kind });
        return { status: "recovered", message: precondition.message } satisfies RecoveryResult;
      }
    }
    return dispatchToHandler(kind, ctx, error);
  };
  const result = policy.serializeRepo
    ? await withRepoLock(ctx.repoDir, dispatch)
    : await dispatch();

  logger.info("dispatch", `recovery complete`, {
    kind,
    result: result.status,
  });
  return result;
}

async function dispatchToHandler(
  kind: SyncErrorKind,
  ctx: RecoveryContext,
  error?: unknown,
): Promise<RecoveryResult> {
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
    case "interrupted_rebase":
      result = await recoverInterruptedRebase(ctx, error);
      break;
    case "interrupted_cherry_pick":
      result = await recoverInterruptedCherryPick(ctx, error);
      break;
    case "interrupted_merge":
      result = await recoverInterruptedMerge(ctx, error);
      break;
    case "unknown":
      result = await recoverUnknown(ctx, error);
      break;
  }
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

export {
  classifyGitError,
  classifyFromHealth,
  RepoNeedsRecoveryError,
  isRepoNeedsRecoveryError,
} from "./classify.ts";
export {
  inspectRepo,
  preflightStructuralReason,
  buildPreflightDiagnostics,
  verifyRepoReadable,
  isUnbornRepo,
} from "./inspect.ts";
export { buildRecoveryContext } from "./context.ts";
export type { BuildRecoveryContextOptions } from "./context.ts";
export { recoveryPolicy, policyFor, detachedHeadWithLocalChangesPolicy } from "./policy.ts";
export { createRecoveryZip, assertZipReadable, zipEntries } from "./backup.ts";
export { makeManualGuidance } from "./manual-guidance.ts";
export { failSafeNoRepair, withBackupGate } from "./failsafe.ts";
