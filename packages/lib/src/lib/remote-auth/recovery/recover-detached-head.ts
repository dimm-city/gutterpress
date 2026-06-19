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
 * Branch resolution (which named version to re-attach to): the detached commit
 * usually belongs to the author's real working branch, which is NOT always
 * "main" (it may be "master", "trunk", …). The handler DISCOVERS that branch
 * (resolveTargetBranch) instead of assuming "main": an explicit ctx.branch
 * wins; otherwise it prefers a sole local branch, then the unique local branch
 * the detached commit belongs to, then the remote's default
 * (refs/remotes/origin/HEAD), and only finally "main". Discovery never throws.
 *
 * The final checkout is FORCED. By that point the prior state is preserved both
 * on the rescue branch and in the verified /tmp backup, so forcing cannot lose
 * work — and it avoids a spurious CheckoutConflictError from an untracked /
 * ignored / stat-dirty file colliding with the target version.
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
 * Read the remote's configured default branch name from
 * refs/remotes/origin/HEAD (a symbolic ref like
 * "ref: refs/remotes/origin/<name>"). Returns the bare branch name, or
 * undefined when the hint is absent/unreadable. Never throws.
 */
async function originDefaultBranch(dir: string): Promise<string | undefined> {
  try {
    const resolved = await git.resolveRef({
      fs,
      dir,
      ref: "refs/remotes/origin/HEAD",
      depth: 1, // read the symbolic target, don't follow all the way to a SHA
    });
    // Depending on the depth, isomorphic-git returns either the raw symref line
    // ("ref: refs/remotes/origin/<name>") or the resolved ref path
    // ("refs/remotes/origin/<name>"). Strip an optional "ref: " prefix so both
    // forms parse identically.
    const target = resolved.replace(/^ref:\s*/, "").trim();
    const prefix = "refs/remotes/origin/";
    if (target.startsWith(prefix)) {
      const name = target.slice(prefix.length).trim();
      if (name && name !== "HEAD") return name;
    }
  } catch {
    // No origin/HEAD hint, or it doesn't resolve — fall through.
  }
  return undefined;
}

/**
 * Decide which named branch to re-attach to after a detached HEAD.
 *
 * The detached commit almost always belongs to the author's real working
 * branch — which is NOT necessarily "main" (it could be "master", "trunk",
 * etc.). Blindly checking out "main" silently relocates their work onto the
 * wrong line. So we discover the right branch, in priority order:
 *
 *   1. An explicit, non-empty `ctx.branch` always wins (the caller knows best).
 *   2. Exactly one local branch → that branch (the unambiguous common case,
 *      e.g. a "master"-only repo).
 *   3. Of several local branches, the unique one that contains the current
 *      HEAD (HEAD reachable from its tip) or whose tip is reachable from HEAD.
 *   4. The remote's configured default branch (refs/remotes/origin/HEAD).
 *   5. "main" as a last resort.
 *
 * `excludeBranch` is our just-created rescue branch — it points AT the detached
 * commit, so leaving it in the candidate set would make every match ambiguous
 * (and could even pick the rescue branch itself). We filter it out so discovery
 * sees only the user's real branches.
 *
 * This NEVER throws — discovery failures degrade gracefully to the next
 * candidate so recovery is always able to proceed.
 */
async function resolveTargetBranch(
  dir: string,
  explicitBranch: string,
  headSha: string | undefined,
  excludeBranch: string,
): Promise<string> {
  // 1. Explicit caller-provided branch wins.
  const explicit = explicitBranch.trim();
  if (explicit) return explicit;

  // 2 & 3. Inspect local branches (excluding our own rescue branch).
  try {
    const branches = (await git.listBranches({ fs, dir })).filter(
      (b) => b !== excludeBranch,
    );
    if (branches.length === 1 && branches[0]) {
      return branches[0];
    }

    if (branches.length > 1 && headSha) {
      const matches: string[] = [];
      for (const name of branches) {
        let tip: string | undefined;
        try {
          tip = await git.resolveRef({ fs, dir, ref: `refs/heads/${name}` });
        } catch {
          continue; // Unresolvable branch — ignore it.
        }
        if (tip === headSha) {
          matches.push(name);
          continue;
        }
        // HEAD reachable from the branch tip, OR the branch tip reachable from
        // HEAD — either way the detached commit belongs to this line.
        const reachable =
          (await isAncestorOrEqual(dir, headSha, tip)) ||
          (await isAncestorOrEqual(dir, tip, headSha));
        if (reachable) matches.push(name);
      }
      // Only act on an UNAMBIGUOUS match; ambiguity falls through to the
      // remote default so we never guess between equally-valid branches.
      if (matches.length === 1 && matches[0]) return matches[0];
    }
  } catch {
    // listBranches failed — fall through to the remote default / "main".
  }

  // 4. Remote's configured default branch.
  const remoteDefault = await originDefaultBranch(dir);
  if (remoteDefault) return remoteDefault;

  // 5. Last-resort default.
  return "main";
}

/**
 * True when `descendant` is reachable from (descended from) `ancestor`, or the
 * two are the same commit. Never throws — returns false on any lookup error.
 */
async function isAncestorOrEqual(
  dir: string,
  descendant: string,
  ancestor: string,
): Promise<boolean> {
  if (descendant === ancestor) return true;
  try {
    return await git.isDescendent({ fs, dir, oid: descendant, ancestor, depth: -1 });
  } catch {
    return false;
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

  // The commit HEAD is detached at, captured BEFORE any rescue snapshot commit
  // advances HEAD. This is the commit whose owning branch we want to discover.
  const detachedHeadSha = await resolveHeadSha(dir);

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

    // ── Decide which named version to re-attach to ────────────────────────
    //
    // Discover the branch the detached commit actually belongs to instead of
    // assuming "main" — that assumption silently relocates a "master"/"trunk"
    // user's work. Discovery happens AFTER the rescue branch exists, so even a
    // surprising target can't cost the user anything.
    const branch = await resolveTargetBranch(
      dir,
      ctx.branch ?? "",
      detachedHeadSha,
      rescueBranch,
    );

    // ── Checkout the configured named version ─────────────────────────────
    await ctx.faults?.before("checkout_branch");
    // FORCE is safe here and prevents a spurious CheckoutConflictError:
    //   - The user's prior state is already preserved twice over — committed to
    //     the rescue branch (created above) AND captured in the verified /tmp
    //     backup zip (withBackupGate created + verified it before this callback).
    //   - Without `force`, an untracked/ignored or stat-dirty working-tree file
    //     that collides with a path the target branch writes makes a plain
    //     checkout throw, failing recovery even though nothing is actually at
    //     risk. Forcing the checkout reconciles the working tree to the named
    //     version; anything it overwrites is recoverable from the rescue branch
    //     or the backup, so no work can be lost.
    await git.checkout({ fs, dir, ref: branch, force: true });

    return {
      status: "recovered",
      message:
        "Your project is back to normal. A rescue copy of your previous state was saved locally.",
      backupZipPath: backupZipPath ?? "",
    } satisfies RecoveryResult;
  });
}
