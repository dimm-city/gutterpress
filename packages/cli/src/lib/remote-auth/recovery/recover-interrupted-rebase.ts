/**
 * recover-interrupted-rebase.ts — abort a rebase that was left unfinished.
 *
 * WHY: If print-md or the OS dies partway through combining versions, the repo
 * can be left mid-rebase: `.git/rebase-merge/` (merge/interactive backend) or
 * `.git/rebase-apply/` (am backend) exists and HEAD is usually detached at a
 * replay commit. Every sync then fails. There is nothing to "finish" for a
 * non-technical author — the only safe move is to UNDO the unfinished update and
 * return the project to its last working state. That is exactly what an abort is.
 *
 * Abort algorithm (pure isomorphic-git + node:fs — never the system git binary):
 *   1. Read the pre-rebase commit from `<stateDir>/orig-head` (fallback:
 *      `.git/ORIG_HEAD`). If it cannot be resolved → THROW (the backup gate
 *      converts it to failed_backup_available; the backup is safe).
 *   2. Resolve the branch from `<stateDir>/head-name` — but ONLY when it is a
 *      genuine `refs/heads/<x>` path. A sentinel like "detached HEAD" (the
 *      rebase started from a detached HEAD) is NOT a branch. Fall back to
 *      ctx.branch only when head-name was ABSENT.
 *   3a. Named branch → rewind the branch ref to the pre-rebase commit and
 *       force-checkout it (re-attaches HEAD, resets tree + index to the tip).
 *   3b. No branch (detached-HEAD rebase) → force-checkout the pre-rebase commit
 *       directly, leaving HEAD detached at it; no branch ref is touched.
 *   4. Remove the transient `.git/rebase-merge` and `.git/rebase-apply` dirs.
 *   5. Verify the markers are gone; if not → THROW.
 *
 * Per-repo serialization (withRepoLock) is provided by the DISPATCHER via the
 * policy's serializeRepo flag; this module wraps only withBackupGate
 * (backup → confirm → risky → failsafe). Inside the callback we
 * call ONLY raw git.* / node:fs — never another lock-wrapped lib function — so
 * the FIFO queue can't deadlock. Re-verification uses direct fs.existsSync of
 * the marker paths, NOT inspectRepo (which would re-enter the lock).
 *
 * The `fs.rmSync` calls target ONLY the transient rebase-state dirs INSIDE the
 * repo's own .git — never user content — and run ONLY after the verified backup.
 *
 * Fault injection points (ctx.faults?.before()):
 *   after_backup_before_repair   — start of the destructive section
 *   abort_interrupted_operation  — start of the abort proper
 *   checkout_branch              — before the force checkout
 *   remove_operation_state       — before deleting the on-disk state dirs
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

const KIND = "interrupted_rebase" as const;

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

export const recover: RecoverFn = async (ctx) => {
  const dir = ctx.repoDir;
  const gitDir = gitDirFor(dir);
  const rebaseMerge = path.join(gitDir, "rebase-merge");
  const rebaseApply = path.join(gitDir, "rebase-apply");

  // TOCTOU guard: the interrupted rebase may have been finished or aborted
  // externally (e.g. the author ran an abort in a terminal) between the
  // preflight classification and now. If no rebase marker remains there is
  // nothing to abort — return a benign no-op WITHOUT creating a backup,
  // prompting, or touching any ref/worktree. Falling through here would let the
  // code below rewind a branch off a possibly-stale `.git/ORIG_HEAD` left by an
  // unrelated operation, unexpectedly moving refs. (Copilot review.)
  if (!fs.existsSync(rebaseMerge) && !fs.existsSync(rebaseApply)) {
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

    // Re-verify state with DIRECT fs checks (not inspectRepo). inspectRepo is
    // a broader preflight probe (re-detects the project source, re-scans for
    // stale locks, walks the working tree for local changes) — overkill for
    // the one narrow fact this TOCTOU re-check needs (which rebase state dir,
    // if either, still exists right now) and would re-read stale-by-design
    // health rather than a fresh, targeted check. Pick whichever backend dir
    // is present.
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
    // when it is a genuine refs/heads/ path — otherwise a sentinel would be
    // turned into a bogus `refs/heads/detached HEAD` ref (the checkout then
    // throws, leaving the markers AND a stray ref behind).
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
      // The backup is already created + verified; surfacing the failure here
      // lets withBackupGate return failed_backup_available (backup is safe).
      throw new Error("Could not determine the project's last working state to restore.");
    }

    // ── Destructive section ─────────────────────────────────────────────────
    await ctx.faults?.before("after_backup_before_repair");
    await ctx.faults?.before("abort_interrupted_operation");

    if (branch) {
      // Named-branch rebase: rewind the branch ref to the pre-rebase commit,
      // then re-attach HEAD to it and reset the working tree + index to the
      // restored tip. FORCE is safe: the verified /tmp backup holds everything.
      await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: origSha, force: true });
      await ctx.faults?.before("checkout_branch");
      await git.checkout({ fs, dir, ref: branch, force: true });
    } else {
      // Detached-HEAD rebase: there is no branch to move. Restore HEAD (still
      // detached) to the pre-rebase commit and reset the tree/index to it.
      await ctx.faults?.before("checkout_branch");
      await git.checkout({ fs, dir, ref: origSha, force: true });
    }

    // Remove the transient operation-state dirs (this IS the abort). These live
    // inside .git and are captured in the backup — removing them is safe.
    await ctx.faults?.before("remove_operation_state");
    if (fs.existsSync(rebaseMerge)) fs.rmSync(rebaseMerge, { recursive: true, force: true });
    if (fs.existsSync(rebaseApply)) fs.rmSync(rebaseApply, { recursive: true, force: true });

    // Verify the abort actually cleared the markers.
    if (fs.existsSync(rebaseMerge) || fs.existsSync(rebaseApply)) {
      throw new Error("The unfinished update could not be fully cleared.");
    }

    return {
      status: "recovered",
      message: successMessage(hadLocalChanges),
      backupZipPath: backupZipPath ?? "",
    } satisfies RecoveryResult;
  });
};
