/**
 * recover-interrupted-rebase.ts — abort a rebase that was left unfinished.
 *
 * WHY: If gutterpress or the OS dies partway through combining versions, the repo
 * can be left mid-rebase: `.git/rebase-merge/` (merge/interactive backend) or
 * `.git/rebase-apply/` (am backend) exists and HEAD is usually detached at a
 * replay commit. Every sync then fails. There is nothing to "finish" for a
 * non-technical author — the only safe move is to UNDO the unfinished update and
 * return the project to its last working state. That is exactly what an abort is.
 *
 * Unlike a merge/cherry-pick (which stop before committing and only need the
 * current branch reset), a rebase advances HEAD, so the abort must rewind the
 * real branch ref to the pre-rebase commit. The shared skeleton in
 * abort-interrupted-operation.ts owns the backup gate, TOCTOU guard,
 * hadLocalChanges capture, fault ordering, checkout, cleanup and re-verify; this
 * module supplies the rebase-specific `resolveTarget` that:
 *   1. Reads the pre-rebase commit from `<stateDir>/orig-head` (fallback:
 *      `.git/ORIG_HEAD`). If it cannot be resolved → THROW (the backup gate
 *      converts it to failed_backup_available; the backup is safe).
 *   2. Resolves the branch from `<stateDir>/head-name` — but ONLY when it is a
 *      genuine `refs/heads/<x>` path. A sentinel like "detached HEAD" (the
 *      rebase started from a detached HEAD) is NOT a branch. Falls back to
 *      ctx.branch only when head-name was ABSENT.
 *   3a. Named branch → rewind the branch ref to the pre-rebase commit and
 *       force-checkout it (re-attaches HEAD, resets tree + index to the tip).
 *   3b. No branch (detached-HEAD rebase) → force-checkout the pre-rebase commit
 *       directly, leaving HEAD detached at it; no branch ref is touched.
 *
 * resolveTarget reads state with DIRECT fs checks (not inspectRepo) — the one
 * narrow fact it needs is which backend dir still exists, not a broad preflight
 * probe that would re-enter the per-repo lock.
 */

import * as fsSync from "node:fs";
import path from "node:path";

import {
  abortInterruptedOperation,
  anyMarkerPresent,
  type AbortResolveArgs,
  type AbortTargetPlan,
} from "./abort-interrupted-operation.ts";
import type { RecoverFn, StillAppliesFn } from "./types.ts";

const fs = fsSync;

const MARKER_FILES = ["rebase-merge", "rebase-apply"];

/**
 * Precondition probe (see types.ts `StillAppliesFn`) — the dispatcher's
 * replacement for the abort skeleton's old hand-rolled TOCTOU guard.
 */
export const stillApplies: StillAppliesFn = async (ctx) => anyMarkerPresent(ctx, MARKER_FILES);

/** Read a file expected to hold a single commit sha; undefined if absent/invalid. */
function readShaFile(p: string): string | undefined {
  try {
    const raw = fs.readFileSync(p, "utf8").trim();
    return /^[0-9a-f]{40,64}$/i.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Read a text file's first line, trimmed; undefined if absent/empty. */
function readLine(p: string): string | undefined {
  try {
    const raw = fs.readFileSync(p, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

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

/**
 * Resolve the pre-rebase restore target. Pick whichever backend dir is present
 * (direct fs check), read the pre-rebase commit + head-name, and decide between
 * rewinding a named branch or restoring a detached HEAD.
 */
async function resolveRebaseTarget({ ctx, gitDir }: AbortResolveArgs): Promise<AbortTargetPlan> {
  const rebaseMerge = path.join(gitDir, "rebase-merge");
  const rebaseApply = path.join(gitDir, "rebase-apply");
  const stateDir = fs.existsSync(rebaseMerge)
    ? rebaseMerge
    : fs.existsSync(rebaseApply)
      ? rebaseApply
      : undefined;

  // Resolve the pre-rebase commit: <stateDir>/orig-head, else .git/ORIG_HEAD.
  const origSha =
    (stateDir ? readShaFile(path.join(stateDir, "orig-head")) : undefined) ??
    readShaFile(path.join(gitDir, "ORIG_HEAD"));

  // Resolve the branch to restore. `<stateDir>/head-name` holds either a real
  // "refs/heads/<x>" path OR a git sentinel (e.g. "detached HEAD") when the
  // rebase was itself started from a detached HEAD. ONLY treat it as a branch
  // when it is a genuine refs/heads/ path — otherwise a sentinel would be turned
  // into a bogus `refs/heads/detached HEAD` ref (the checkout then throws,
  // leaving the markers AND a stray ref behind).
  let branch: string | undefined;
  let headNamePresent = false;
  if (stateDir) {
    const headName = readLine(path.join(stateDir, "head-name"));
    if (headName) {
      headNamePresent = true;
      if (headName.startsWith("refs/heads/")) {
        branch = headName.slice("refs/heads/".length).trim() || undefined;
      }
      // A present-but-non-branch head-name means the rebase started from a
      // detached HEAD → leave `branch` undefined and restore detached below.
    }
  }
  // Fall back to ctx.branch ONLY when head-name was ABSENT (unknown backend or
  // unreadable) — never when it was present-but-detached, which would wrongly
  // move ctx.branch onto the pre-rebase commit.
  if (!branch && !headNamePresent) branch = (ctx.branch ?? "").trim() || undefined;

  if (!origSha) {
    // The backup is already created + verified; surfacing the failure here lets
    // withBackupGate return failed_backup_available (backup is safe).
    throw new Error("Could not determine the project's last working state to restore.");
  }

  if (branch) {
    // Named-branch rebase: rewind the branch ref to the pre-rebase commit, then
    // re-attach HEAD to it and reset the working tree + index to the restored tip.
    return { checkoutRef: branch, writeRefBranch: branch, writeRefValue: origSha };
  }
  // Detached-HEAD rebase: there is no branch to move. Restore HEAD (still
  // detached) to the pre-rebase commit and reset the tree/index to it.
  return { checkoutRef: origSha };
}

export const recover: RecoverFn = (ctx) =>
  abortInterruptedOperation(ctx, {
    kind: "interrupted_rebase",
    markerFiles: MARKER_FILES,
    cleanupFiles: ["rebase-merge", "rebase-apply"],
    resolveTarget: resolveRebaseTarget,
    successMessage,
  });
