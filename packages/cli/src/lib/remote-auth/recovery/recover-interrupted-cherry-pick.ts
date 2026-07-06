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
 * The shared skeleton in abort-interrupted-operation.ts owns the backup gate,
 * TOCTOU guard, hadLocalChanges capture, fault ordering, checkout, cleanup and
 * re-verify; this module only supplies the cherry-pick-specific config (default
 * branch resolution: ctx.branch → git.currentBranch → "HEAD", HEAD stays
 * attached during a cherry-pick).
 */

import { abortInterruptedOperation, anyMarkerPresent } from "./abort-interrupted-operation.ts";
import type { RecoverFn, StillAppliesFn } from "./types.ts";

const MARKER_FILES = ["CHERRY_PICK_HEAD"];

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
    kind: "interrupted_cherry_pick",
    markerFiles: MARKER_FILES,
    cleanupFiles: ["CHERRY_PICK_HEAD", "MERGE_MSG", "sequencer"],
    successMessage,
  });
