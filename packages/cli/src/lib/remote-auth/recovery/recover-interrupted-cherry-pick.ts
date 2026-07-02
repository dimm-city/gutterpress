/**
 * recover-interrupted-cherry-pick.ts — abort a cherry-pick left unfinished.
 *
 * WHY: A conflicted cherry-pick stops BEFORE committing, so — unlike a rebase —
 * it does NOT advance HEAD. There is no branch ref to rewind: only the
 * half-applied index/worktree conflict state and the `.git/CHERRY_PICK_HEAD`
 * marker (plus MERGE_MSG / sequencer) to clear. For a non-technical author the
 * safe move is to UNDO the unfinished update and return to the last working
 * state — which is a force-checkout of the current branch + marker cleanup.
 *
 * Abort algorithm (pure isomorphic-git + node:fs — never the system git binary):
 *   1. Resolve the branch: ctx.branch, else git.currentBranch (HEAD stays
 *      attached during a cherry-pick), else fall back to force-checking "HEAD".
 *   2. Force-checkout the branch — resets index + worktree to HEAD, discarding
 *      the half-applied conflict state (safe: the verified backup holds all of it).
 *   3. Remove `.git/CHERRY_PICK_HEAD` (and best-effort `.git/MERGE_MSG` +
 *      `.git/sequencer/`).
 *   4. Verify CHERRY_PICK_HEAD is gone; if not → THROW.
 *
 * Per-repo serialization (withRepoLock) is provided by the DISPATCHER via the
 * policy's serializeRepo flag; this module wraps only withBackupGate
 * (backup → confirm → risky → failsafe). Inside the callback we call ONLY raw
 * git.* / node:fs — never a lock-wrapped lib function — so the FIFO queue can't
 * deadlock. Re-verification uses direct fs.existsSync, not inspectRepo.
 *
 * The `fs.rmSync` calls target ONLY the transient cherry-pick state paths INSIDE
 * the repo's own .git — never user content — and run ONLY after the verified backup.
 *
 * Fault injection points (ctx.faults?.before()):
 *   after_backup_before_repair   — start of the destructive section
 *   abort_interrupted_operation  — start of the abort proper
 *   checkout_branch              — before the force checkout
 *   remove_operation_state       — before deleting the on-disk state files
 *
 * Author-facing copy: no git words in userSummary/recommendedNextStep/etc.
 */

import * as fsSync from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { gitDirFor, hasPendingChanges } from "../../source-provider.ts";
import { withBackupGate } from "./failsafe.ts";
import type { RecoverFn, RecoveryResult } from "./types.ts";

const fs = fsSync;

const KIND = "interrupted_cherry_pick" as const;

/**
 * Success message. If the author had in-progress edits, be HONEST that the abort
 * reset the working tree and those edits live in the safety copy (surfaced via
 * backupZipPath) — never claim "nothing was lost".
 */
function successMessage(hadLocalChanges: boolean): string {
  if (hadLocalChanges) {
    return (
      "Your project is back to its last working state. Any unfinished edits from " +
      "the update that didn't complete were set aside in the safety copy that was " +
      "saved first, so you can retrieve them."
    );
  }
  return "Your project is back to its last working state. A safety copy was saved first.";
}

export const recover: RecoverFn = async (ctx) => {
  const dir = ctx.repoDir;
  const gitDir = gitDirFor(dir);
  const cherryPickHead = path.join(gitDir, "CHERRY_PICK_HEAD");

  // TOCTOU guard: the cherry-pick may have been finished or aborted externally
  // (e.g. the author ran an abort in a terminal) between the preflight
  // classification and now. If CHERRY_PICK_HEAD is gone there is nothing to
  // abort — return a benign no-op WITHOUT creating a backup, prompting, or
  // force-resetting the working tree. Falling through would discard uncommitted
  // worktree/index state for a repair that is no longer needed. (Copilot review.)
  if (!fs.existsSync(cherryPickHead)) {
    return {
      status: "recovered",
      message:
        "Your project was already back to its last working state; no changes were needed.",
    } satisfies RecoveryResult;
  }

  return withBackupGate(ctx, KIND, async (backupZipPath) => {
    // Capture the working-tree state BEFORE aborting (best-effort) so the
    // success copy can honestly report whether in-progress edits were reset.
    let hadLocalChanges = false;
    try {
      hadLocalChanges = await hasPendingChanges(dir);
    } catch {
      hadLocalChanges = true; // conservative: assume dirty if we can't tell
    }

    // Resolve the branch to reset to. HEAD stays attached during a cherry-pick.
    let branch = (ctx.branch ?? "").trim();
    if (!branch) {
      try {
        branch = (await git.currentBranch({ fs, dir })) ?? "";
      } catch {
        branch = "";
      }
    }
    const checkoutRef = branch || "HEAD";

    // ── Destructive section ─────────────────────────────────────────────────
    await ctx.faults?.before("after_backup_before_repair");
    await ctx.faults?.before("abort_interrupted_operation");

    // Reset index + worktree to HEAD, discarding the half-applied conflict
    // state. FORCE is safe: the verified /tmp backup holds everything.
    await ctx.faults?.before("checkout_branch");
    await git.checkout({ fs, dir, ref: checkoutRef, force: true });

    // Remove the transient cherry-pick state files (this IS the abort). These
    // live inside .git and are captured in the backup — removing them is safe.
    await ctx.faults?.before("remove_operation_state");
    fs.rmSync(cherryPickHead, { recursive: true, force: true });
    fs.rmSync(path.join(gitDir, "MERGE_MSG"), { recursive: true, force: true });
    fs.rmSync(path.join(gitDir, "sequencer"), { recursive: true, force: true });

    // Verify the abort actually cleared the marker.
    if (fs.existsSync(cherryPickHead)) {
      throw new Error("The unfinished update could not be fully cleared.");
    }

    return {
      status: "recovered",
      message: successMessage(hadLocalChanges),
      backupZipPath: backupZipPath ?? "",
    } satisfies RecoveryResult;
  });
};
