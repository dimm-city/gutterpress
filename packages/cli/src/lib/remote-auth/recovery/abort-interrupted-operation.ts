/**
 * abort-interrupted-operation.ts — shared skeleton for aborting an unfinished
 * git operation (merge / cherry-pick / rebase) left on disk.
 *
 * WHY (DRY): recover-interrupted-merge, recover-interrupted-cherry-pick, and
 * recover-interrupted-rebase were ~90% identical — same TOCTOU guard, same
 * backup gate, same hadLocalChanges capture, same fault-injection ordering,
 * same force-checkout + marker cleanup + re-verify. The ONLY real differences
 * are: which marker files signal the state, which files to remove, and how to
 * resolve the ref to restore (merge/cherry-pick reset the current branch; a
 * rebase may rewind a named branch to a recorded pre-rebase commit OR restore a
 * detached HEAD). Those three differences are captured in `AbortConfig`; the
 * invariant ordering lives here, once.
 *
 * Abort algorithm (pure isomorphic-git + node:fs — never the system git binary):
 *   1. TOCTOU precondition: if NONE of `markerFiles` exist, the operation was
 *      already finished/aborted externally and there is nothing to abort. This
 *      is now enforced by the DISPATCHER (dispatch.ts), which calls each
 *      kind's exported `stillApplies` — built from `anyMarkerPresent` below —
 *      INSIDE withRepoLock, before this function is ever invoked. There used
 *      to be a duplicate hand-rolled copy of this same check at the top of
 *      this function; it is deleted, not kept alongside the dispatcher probe,
 *      because — unlike recover-missing-git-dir.ts — this function has no
 *      SECOND re-check later (no re-check after the backup/confirm wait), so
 *      the one check and the dispatcher probe cover the exact same window: the
 *      dispatcher probe runs immediately before this function's synchronous
 *      entry, with no work in between, just as the deleted local check did.
 *   2. withBackupGate (backup → confirm → risky → failsafe). Inside the callback:
 *   3. Capture whether the working tree had in-progress edits (best-effort).
 *   4. Resolve the restore target via `resolveTarget` (default:
 *      ctx.branch → git.currentBranch → "HEAD"). resolveTarget MAY throw (e.g.
 *      the rebase cannot find its pre-op commit) — that surfaces as
 *      failed_backup_available since the backup is already safe.
 *   5. Optionally rewind a named branch ref to a recorded commit, then
 *      force-checkout the target (resets index + worktree).
 *   6. Remove the transient `cleanupFiles` inside .git.
 *   7. Verify every `markerFiles` entry is gone; if not → THROW.
 *
 * Inside the risky callback we call ONLY raw git.* / node:fs — never a
 * lock-wrapped lib function — so the dispatcher's per-repo FIFO queue can't
 * deadlock. Re-verification uses direct fs.existsSync, not inspectRepo. All
 * removed paths live INSIDE the repo's own .git and are captured in the verified
 * backup — never user content.
 *
 * Fault injection points (ctx.faults?.before()):
 *   after_backup_before_repair   — start of the destructive section
 *   abort_interrupted_operation  — start of the abort proper
 *   checkout_branch              — before the force checkout
 *   remove_operation_state       — before deleting the on-disk state files
 */

import * as fsSync from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { gitDirFor, hasPendingChanges } from "../../source-provider.ts";
import { withBackupGate } from "./failsafe.ts";
import type { RecoveryContext, RecoveryResult, SyncErrorKind } from "./types.ts";

const fs = fsSync;

/**
 * True when any of `markerFiles` (gitDir-relative) still exists. Shared by
 * each interrupted-* handler's exported `stillApplies` (the dispatcher's
 * precondition probe, see types.ts `StillAppliesFn`) so there is ONE
 * implementation of "is this abort still needed", not three copies.
 */
export function anyMarkerPresent(ctx: RecoveryContext, markerFiles: string[]): boolean {
  const gitDir = gitDirFor(ctx.repoDir);
  return markerFiles.some((f) => fs.existsSync(path.join(gitDir, f)));
}

/** Arguments handed to a config's `resolveTarget`. */
export interface AbortResolveArgs {
  ctx: RecoveryContext;
  /** The git repository root (ctx.repoDir). */
  dir: string;
  /** The resolved `.git` directory for `dir`. */
  gitDir: string;
}

/** Which ref to restore and (optionally) which branch ref to rewind first. */
export interface AbortTargetPlan {
  /** The ref to force-checkout (a branch name, a commit sha, or "HEAD"). */
  checkoutRef: string;
  /**
   * When set, `refs/heads/<writeRefBranch>` is force-written to `writeRefValue`
   * BEFORE the checkout (used to rewind a named branch to a pre-op commit). Omit
   * to leave all refs untouched (merge/cherry-pick and detached-HEAD rebase).
   */
  writeRefBranch?: string;
  writeRefValue?: string;
}

/** The per-operation differences the shared skeleton parameterizes. */
export interface AbortConfig {
  /** Recovery kind — drives policy (backup/confirm) and guidance copy. */
  kind: SyncErrorKind;
  /**
   * gitDir-relative marker paths whose presence signals the interrupted state.
   * If NONE exist the abort is a benign no-op; after the abort ALL must be gone.
   */
  markerFiles: string[];
  /** gitDir-relative paths removed during the abort (force; missing is fine). */
  cleanupFiles: string[];
  /**
   * Resolve which ref to restore. Defaults to
   * ctx.branch → git.currentBranch → "HEAD". MAY throw to abort the repair
   * (the verified backup makes that safe → failed_backup_available).
   */
  resolveTarget?: (args: AbortResolveArgs) => Promise<AbortTargetPlan>;
  /** Build the success message; `hadLocalChanges` reports whether edits were reset. */
  successMessage: (hadLocalChanges: boolean) => string;
}

/**
 * Default restore target for operations that stop BEFORE committing (merge,
 * cherry-pick): HEAD stays attached, so just reset the current branch.
 * Resolution order: ctx.branch → git.currentBranch → "HEAD".
 */
async function defaultResolveTarget({ ctx, dir }: AbortResolveArgs): Promise<AbortTargetPlan> {
  let branch = (ctx.branch ?? "").trim();
  if (!branch) {
    try {
      branch = (await git.currentBranch({ fs, dir })) ?? "";
    } catch {
      branch = "";
    }
  }
  return { checkoutRef: branch || "HEAD" };
}

/**
 * Abort an interrupted git operation per `config`. See the module header for the
 * full algorithm and safety invariants.
 */
export async function abortInterruptedOperation(
  ctx: RecoveryContext,
  config: AbortConfig,
): Promise<RecoveryResult> {
  const dir = ctx.repoDir;
  const gitDir = gitDirFor(dir);

  // The "operation already finished/aborted externally, nothing to abort"
  // TOCTOU guard that used to live here is now the dispatcher's job — see the
  // module header note above `anyMarkerPresent`.

  return withBackupGate(ctx, config.kind, async (backupZipPath) => {
    // Capture the working-tree state BEFORE aborting (best-effort) so the
    // success copy can honestly report whether in-progress edits were reset.
    let hadLocalChanges = false;
    try {
      hadLocalChanges = await hasPendingChanges(dir);
    } catch {
      hadLocalChanges = true; // conservative: assume dirty if we can't tell
    }

    // Resolve the restore target BEFORE the destructive section. resolveTarget
    // reads state files with DIRECT fs checks (not inspectRepo) and MAY throw —
    // the backup is already created + verified, so a throw here surfaces as
    // failed_backup_available (the backup is safe).
    const resolve = config.resolveTarget ?? defaultResolveTarget;
    const target = await resolve({ ctx, dir, gitDir });

    // ── Destructive section ─────────────────────────────────────────────────
    await ctx.faults?.before("after_backup_before_repair");
    await ctx.faults?.before("abort_interrupted_operation");

    // Optionally rewind a named branch to its recorded pre-op commit. FORCE is
    // safe: the verified backup holds everything.
    if (target.writeRefBranch) {
      await git.writeRef({
        fs,
        dir,
        ref: `refs/heads/${target.writeRefBranch}`,
        value: target.writeRefValue ?? "",
        force: true,
      });
    }

    // Reset index + worktree, discarding the half-applied state.
    await ctx.faults?.before("checkout_branch");
    await git.checkout({ fs, dir, ref: target.checkoutRef, force: true });

    // Remove the transient operation-state paths (this IS the abort). These live
    // inside .git and are captured in the backup — removing them is safe.
    await ctx.faults?.before("remove_operation_state");
    for (const f of config.cleanupFiles) {
      fs.rmSync(path.join(gitDir, f), { recursive: true, force: true });
    }

    // Verify the abort actually cleared the markers.
    if (anyMarkerPresent(ctx, config.markerFiles)) {
      throw new Error("The unfinished update could not be fully cleared.");
    }

    return {
      status: "recovered",
      message: config.successMessage(hadLocalChanges),
      backupZipPath: backupZipPath ?? "",
    } satisfies RecoveryResult;
  });
}
