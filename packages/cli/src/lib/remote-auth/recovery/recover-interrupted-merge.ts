/**
 * recover-interrupted-merge.ts — abort a merge left unfinished.
 *
 * WHY: print-md itself never leaves a merge half-done (isomorphic-git's merge
 * either completes or aborts in memory and never writes MERGE_HEAD), so this
 * state comes from OUTSIDE the app: the author ran `git merge`/`git pull` in a
 * terminal, hit conflicts, and walked away. The repo then has
 * `.git/MERGE_HEAD` plus conflict markers in tracked files, and every sync
 * would otherwise snapshot those markers into history. For a non-technical
 * author the safe move is to UNDO the unfinished merge and return to the last
 * working state.
 *
 * A conflicted merge stops BEFORE committing, so — like a cherry-pick and
 * unlike a rebase — HEAD stays attached and no branch ref moved. The abort is a
 * force-checkout of the current branch (resets index + worktree to HEAD) plus
 * removal of the merge marker files. The shared skeleton in
 * abort-interrupted-operation.ts owns the backup gate, TOCTOU guard,
 * hadLocalChanges capture, fault ordering, checkout, cleanup and re-verify; this
 * module only supplies the merge-specific config (default branch resolution:
 * ctx.branch → git.currentBranch → "HEAD").
 */

import { abortInterruptedOperation, anyMarkerPresent } from "./abort-interrupted-operation.ts";
import type { RecoverFn, StillAppliesFn } from "./types.ts";

const MARKER_FILES = ["MERGE_HEAD"];

/**
 * Precondition probe (see types.ts `StillAppliesFn`) — the dispatcher's
 * replacement for the abort skeleton's old hand-rolled TOCTOU guard.
 */
export const stillApplies: StillAppliesFn = async (ctx) => anyMarkerPresent(ctx, MARKER_FILES);

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

export const recover: RecoverFn = (ctx) =>
  abortInterruptedOperation(ctx, {
    kind: "interrupted_merge",
    markerFiles: MARKER_FILES,
    cleanupFiles: ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE"],
    successMessage,
  });
