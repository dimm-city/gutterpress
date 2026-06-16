/**
 * recover-detached-head.ts — recover from a detached HEAD state.
 *
 * WHY: When an author's version history ends up in "detached" mode, syncing
 * fails completely. This happens when the working copy landed on a specific
 * saved point rather than the live named copy of the work.
 * The repair re-attaches the copy to the named working version.
 *
 * All cases use a unified path through withBackupGate so fault injection
 * points are consistent and predictable:
 *
 *   Case A — clean working tree, current point IS reachable from the
 *             configured version line:
 *             Backup → create local rescue copy at current HEAD →
 *             checkout named version → 'recovered'.
 *
 *   Case B — orphan saved point (NOT reachable from the named version line):
 *             Same path as Case A; the rescue copy preserves the orphan.
 *
 *   Case C — uncommitted edits in the working tree:
 *             Backup → stage + commit edits to rescue copy →
 *             checkout named version → 'recovered'.
 *             DENY → blocked, everything unchanged.
 *
 * Fault injection points (called via ctx.faults?.before()):
 *   backup_create               — before the zip is written
 *   backup_verify               — after the zip is written, before verifying
 *   commit_recovery_snapshot    — before staging + committing local edits (Case C)
 *   create_recovery_branch      — before writing the rescue branch ref
 *   checkout_branch             — before the final checkout
 *
 * Safety invariants:
 *   - NEVER force-push (push is never called; the rescue copy is local-only).
 *   - /tmp zip backup created and verified BEFORE any branch/checkout op.
 *   - backup_create fault → failed_no_changes_made, no writes after.
 *   - mid-repair fault → failed_backup_available, backup readable, remote unchanged.
 *   - confirmation DENIED → blocked, local + remote unchanged.
 *
 * Author-facing copy: no git words, no tokens, no internal paths in userSummary.
 */

import * as fsSync from "node:fs";

import git from "isomorphic-git";

import { gitAuthor, hasPendingChanges } from "../../source-provider.ts";
import { withBackupGate } from "./failsafe.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

const fs = fsSync;

// ── Constants ─────────────────────────────────────────────────────────────────

const KIND = "detached_head" as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the SHA that HEAD currently points at (even in detached state).
 * Returns undefined if HEAD is unresolvable.
 */
async function resolveHeadSha(dir: string): Promise<string | undefined> {
  try {
    return await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch {
    return undefined;
  }
}

/**
 * Build a timestamped rescue branch name.
 * e.g. "recovery/detached-head-1738411200000"
 */
function recoveryBranchName(now: () => number): string {
  return `recovery/detached-head-${now()}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Recover from a detached HEAD state.
 * Implements the RecoverFn contract (types.ts).
 */
export async function recover(
  ctx: RecoveryContext,
  _error?: unknown,
): Promise<RecoveryResult> {
  const dir = ctx.repoDir;
  const branch = ctx.branch || "main";
  const nowFn = ctx.now ?? (() => Date.now());
  const author = gitAuthor(ctx.authorName);

  // ── Determine working tree state ──────────────────────────────────────────
  let hasChanges = false;
  try {
    hasChanges = await hasPendingChanges(dir);
  } catch {
    // If we can't check, assume dirty (conservative).
    hasChanges = true;
  }

  // ── Unified repair path through withBackupGate ────────────────────────────
  //
  // All three cases (A, B, C) share the same invariant ordering:
  //   backup → confirmation → create rescue copy → checkout named version.
  //
  // This ensures the fault injection point create_recovery_branch is always
  // present regardless of whether the detached commit is reachable or not.
  return withBackupGate(ctx, KIND, async (backupZipPath) => {
    const rescueBranch = recoveryBranchName(nowFn);

    if (hasChanges) {
      // ── Case C: stage and commit working-tree changes to rescue copy ────
      await ctx.faults?.before("commit_recovery_snapshot");

      // Stage all working-tree changes (adds, modifications, deletions).
      const matrix = await git.statusMatrix({ fs, dir });
      for (const [filepath, , workdir, stage] of matrix) {
        if (workdir !== stage) {
          if (workdir === 0) {
            // File deleted from working tree — remove from index.
            await git.remove({ fs, dir, filepath: filepath as string });
          } else {
            // File added or modified — add to index.
            await git.add({ fs, dir, filepath: filepath as string });
          }
        }
      }

      // Commit staged changes. This creates a new commit on the detached HEAD.
      await git.commit({
        fs,
        dir,
        message: "Save work in progress (automatic rescue snapshot)",
        author,
      });
    }

    // ── Create the rescue branch at the current HEAD ──────────────────────
    //
    // Always create this branch so:
    //   - Orphan commits (Case B) are preserved by reference.
    //   - Committed rescue snapshots (Case C) are preserved by reference.
    //   - Case A also passes through this point so fault injection is
    //     consistent across all paths (the branch is a no-op anchor).
    const currentHeadSha = await resolveHeadSha(dir);
    if (!currentHeadSha) {
      throw new Error("Could not resolve current saved point to create rescue copy");
    }

    await ctx.faults?.before("create_recovery_branch");
    await git.branch({ fs, dir, ref: rescueBranch, object: currentHeadSha });

    // ── Checkout the configured named version ─────────────────────────────
    await ctx.faults?.before("checkout_branch");
    await git.checkout({ fs, dir, ref: branch });

    return {
      status: "recovered",
      message:
        "Your project is back to normal. A rescue copy of your previous state was saved locally.",
      backupZipPath: backupZipPath ?? "",
    } satisfies RecoveryResult;
  });
}
