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
 * Notes on two health facts:
 *   - hasGitDir is true whenever `.git/` EXISTS, even with a missing/corrupt
 *     HEAD (a damaged repo is still a repo — see the inline note at the check).
 *   - hasStaleLock scans the SAME lock set as the stale-lock recovery handler
 *     (index.lock + HEAD.lock + config.lock + packed-refs.lock + refs/**\/*.lock)
 *     so health and handler stay in agreement.
 *
 * All I/O is synchronous fs.existsSync / fs.statSync / fs.readdirSync to keep
 * this fast and throw-free (the caller must never see an exception from a
 * preflight probe).
 */

import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../../project-source.ts";
import { gitDirFor, gitScopeFor, hasPendingChanges } from "../../source-provider.ts";
import type { RepoHealth, RecoveryContext } from "./types.ts";

/**
 * Known top-level lock files git may leave directly under `.git/` after a crash.
 *
 * MUST stay in lockstep with TOP_LEVEL_LOCK_NAMES in recover-stale-lock.ts: the
 * preflight health probe (here) decides WHETHER the stale-lock handler runs, and
 * the handler decides WHAT to remove. If health scanned fewer paths than the
 * handler, a stuck HEAD.lock / config.lock / packed-refs.lock would never
 * trigger recovery and the repo would stay unusable forever.
 */
const TOP_LEVEL_LOCK_NAMES = [
  "index.lock",
  "HEAD.lock",
  "config.lock",
  "packed-refs.lock",
] as const;

/**
 * Recursively collect `*.lock` file paths under `dir` (best-effort, never
 * throws). Mirrors collectRefLockPaths in recover-stale-lock.ts so health and
 * handler agree on per-ref locks (e.g. refs/heads/main.lock at any depth).
 * Synchronous to keep inspect.ts throw-free and fast.
 */
function collectRefLockPathsSync(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Missing/unreadable — nothing to collect here.
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRefLockPathsSync(abs, out);
    } else if (entry.isFile() && entry.name.endsWith(".lock")) {
      out.push(abs);
    }
  }
}

/**
 * Scan a `.git` dir for ALL known stale-lock files (top-level + refs/**) and
 * return whether any exist plus the age (ms) of the YOUNGEST lock.
 *
 * The youngest age is the right signal for the handler's decision rule: "if ANY
 * lock is fresh, a live process may still hold it — wait". The smallest age
 * decides whether to back off, so health reports that same value. Returns
 * `lockAgeMs: undefined` when no lock exists (or none could be stat'd). Never
 * throws — a vanished/unreadable lock between readdir and stat is simply skipped.
 */
function scanStaleLocks(gitDir: string, now: number): {
  hasStaleLock: boolean;
  lockAgeMs: number | undefined;
} {
  const paths: string[] = TOP_LEVEL_LOCK_NAMES.map((name) => path.join(gitDir, name));
  collectRefLockPathsSync(path.join(gitDir, "refs"), paths);

  let youngestAgeMs: number | undefined;
  for (const p of paths) {
    try {
      const s = fs.statSync(p);
      if (!s.isFile()) continue;
      const ageMs = now - s.mtimeMs;
      if (youngestAgeMs === undefined || ageMs < youngestAgeMs) youngestAgeMs = ageMs;
    } catch {
      // Not present (or unreadable) — skip.
    }
  }
  return { hasStaleLock: youngestAgeMs !== undefined, lockAgeMs: youngestAgeMs };
}

/**
 * Probe the local repository and return a RepoHealth snapshot.
 * Never throws — on any error the relevant flag is set conservatively.
 */
export async function inspectRepo(ctx: Pick<RecoveryContext, "repoDir">): Promise<RepoHealth> {
  // CRITICAL: resolve the ACTUAL git root. A project is often opened at a
  // SUBFOLDER of its repo ("opening a subfolder syncs the whole repo"), so
  // checking the raw opened dir for `.git` would false-positive `missing_git_dir`
  // on every such project — which then runs the destructive missing-history
  // recovery (and OOMs zipping a large `.git`). Use the SAME resolution as the
  // sync path (detectProjectSource → gitScopeFor) so health and sync agree.
  // Genuine missing-git (no `.git` anywhere up the tree) classifies as
  // local-folder, so repoDir stays the opened dir and hasGitDir is correctly
  // false — the real recovery case is preserved.
  let repoDir = ctx.repoDir;
  try {
    const source = await detectProjectSource(ctx.repoDir);
    if (source.type === "local-git-folder") repoDir = gitScopeFor(source);
  } catch {
    // Classification failed — fall back to the opened dir.
  }

  // ── .git presence ────────────────────────────────────────────────────────
  //
  // A repo EXISTS when `.git/` is present — even if HEAD is missing or corrupt.
  // We must NOT also require `.git/HEAD` here: a repo whose HEAD was lost (an
  // interrupted write / truncated checkout) is a DAMAGED repo, not an absent
  // one. Requiring HEAD made such a repo report hasGitDir=false → the classifier
  // returns `missing_git_dir`, whose handler CLONES and talks about "setting up
  // a remote" — exactly the wrong fix when the repo already exists and only its
  // HEAD is broken. Leaving hasGitDir=true keeps it on a repair-the-existing-repo
  // path (e.g. detached_head / missing_or_corrupt_objects), which preserves work.
  // Genuine missing-git (no `.git` anywhere up the tree) still resolves to the
  // opened dir above with no `.git`, so hasGitDir is correctly false there.
  const gitDir = gitDirFor(repoDir);
  const hasGitDir = fs.existsSync(gitDir);

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
  //
  // Detect EVERY known git lock (index.lock, HEAD.lock, config.lock,
  // packed-refs.lock, and per-ref refs/**/*.lock) — the same set the stale-lock
  // recovery handler scans — so a stuck lock of any kind actually triggers it.
  // lockAgeMs reflects the YOUNGEST lock, matching the handler's "if any lock is
  // fresh, wait" rule (the smallest age decides whether to back off).
  const { hasStaleLock, lockAgeMs } = scanStaleLocks(gitDir, Date.now());

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
