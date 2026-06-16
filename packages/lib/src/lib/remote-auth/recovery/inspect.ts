/**
 * Preflight repo health probe for the sync-recovery subsystem.
 *
 * inspectRepo() reads local filesystem state ONLY — no network, no git objects,
 * never throws. It returns a RepoHealth snapshot that the classifier and policy
 * lookup use to decide which recovery path to take.
 *
 * Reuses:
 *   - gitDirFor (source-provider.ts) for the .git dir path
 *   - hasPendingChanges (source-provider.ts) for local-changes detection
 *
 * All I/O is synchronous fs.existsSync / fs.statSync to keep this fast and
 * throw-free (the caller must never see an exception from a preflight probe).
 */

import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { gitDirFor, hasPendingChanges } from "../../source-provider.ts";
import type { RepoHealth, RecoveryContext } from "./types.ts";

/**
 * Probe the local repository and return a RepoHealth snapshot.
 * Never throws — on any error the relevant flag is set conservatively.
 */
export async function inspectRepo(ctx: Pick<RecoveryContext, "repoDir">): Promise<RepoHealth> {
  const repoDir = ctx.repoDir;

  // ── .git presence ────────────────────────────────────────────────────────
  const gitDir = gitDirFor(repoDir);
  const hasGitDir = fs.existsSync(gitDir) && fs.existsSync(path.join(gitDir, "HEAD"));

  if (!hasGitDir) {
    return {
      hasGitDir: false,
      isDetachedHead: false,
      hasStaleLock: false,
      hasInterruptedMerge: false,
      hasInterruptedRebase: false,
      hasInterruptedCherryPick: false,
      hasLocalChanges: false,
    };
  }

  // ── Detached HEAD ────────────────────────────────────────────────────────
  let currentBranch: string | undefined;
  let isDetachedHead = false;
  try {
    const branch = await git.currentBranch({ fs, dir: repoDir });
    if (branch == null) {
      isDetachedHead = true;
    } else {
      currentBranch = branch;
    }
  } catch {
    isDetachedHead = true;
  }

  // ── Stale lock ────────────────────────────────────────────────────────────
  const lockPath = path.join(gitDir, "index.lock");
  const hasStaleLock = fs.existsSync(lockPath);
  let lockAgeMs: number | undefined;
  if (hasStaleLock) {
    try {
      const stat = fs.statSync(lockPath);
      lockAgeMs = Date.now() - stat.mtimeMs;
    } catch {
      lockAgeMs = undefined;
    }
  }

  // ── In-progress operations ────────────────────────────────────────────────
  const hasInterruptedMerge = fs.existsSync(path.join(gitDir, "MERGE_HEAD"));
  const hasInterruptedRebase =
    fs.existsSync(path.join(gitDir, "rebase-merge")) ||
    fs.existsSync(path.join(gitDir, "rebase-apply"));
  const hasInterruptedCherryPick = fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"));

  // ── Local changes ─────────────────────────────────────────────────────────
  let hasLocalChanges = false;
  try {
    hasLocalChanges = await hasPendingChanges(repoDir);
  } catch {
    // If we can't check (e.g. corrupt index), assume dirty.
    hasLocalChanges = true;
  }

  return {
    hasGitDir,
    currentBranch,
    isDetachedHead,
    hasStaleLock,
    lockAgeMs,
    hasInterruptedMerge,
    hasInterruptedRebase,
    hasInterruptedCherryPick,
    hasLocalChanges,
  };
}
