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
 *   - hasStaleLock uses the stale-lock handler's OWN lock scanner
 *     (findLockCandidates in recover-stale-lock.ts) — one implementation, so
 *     health and handler can never disagree about which locks exist.
 *
 * All probes are best-effort and throw-free (the caller must never see an
 * exception from a preflight probe).
 */

import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../../project-source.ts";
import { gitDirFor, gitScopeFor, hasPendingChanges } from "../../source-provider.ts";
import type { LogData } from "../operation-log.ts";
import { findLockCandidates } from "./recover-stale-lock.ts";
import type { RepoHealth, RecoveryContext, SyncErrorKind } from "./types.ts";

/**
 * Probe the local repository and return a RepoHealth snapshot.
 * Never throws — on any error the relevant flag is set conservatively.
 *
 * `checkLocalChanges: false` skips the hasPendingChanges working-tree walk
 * (the one non-trivial probe) and reports hasLocalChanges=false. Use it when
 * only the structural flags matter — e.g. syncProject's preflight, whose
 * pull step immediately performs the same walk anyway (sync-simplicity
 * mandate: no redundant walks on the hot path).
 */
export async function inspectRepo(
  ctx: Pick<RecoveryContext, "repoDir">,
  opts: { checkLocalChanges?: boolean } = {},
): Promise<RepoHealth> {
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
  // Detect EVERY known git lock via the stale-lock handler's own scanner —
  // one implementation for health and handler. lockAgeMs reflects the
  // YOUNGEST lock, matching the handler's "if any lock is fresh, wait" rule
  // (the smallest age decides whether to back off).
  const lockCandidates = await findLockCandidates(gitDir, Date.now());
  const hasStaleLock = lockCandidates.length > 0;
  const lockAgeMs = hasStaleLock
    ? Math.min(...lockCandidates.map((c) => c.ageMs))
    : undefined;

  // ── In-progress operations ────────────────────────────────────────────────
  const hasInterruptedMerge = fs.existsSync(path.join(gitDir, "MERGE_HEAD"));
  const hasInterruptedRebase =
    fs.existsSync(path.join(gitDir, "rebase-merge")) ||
    fs.existsSync(path.join(gitDir, "rebase-apply"));
  const hasInterruptedCherryPick = fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"));

  // ── Local changes ─────────────────────────────────────────────────────────
  let hasLocalChanges = false;
  if (opts.checkLocalChanges !== false) {
    try {
      hasLocalChanges = await hasPendingChanges(repoDir);
    } catch {
      // If we can't check (e.g. corrupt index), assume dirty.
      hasLocalChanges = true;
    }
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

// ── Preflight diagnostics (structured operation-log fields) ───────────────────
// Pure mappers shared by every host that logs WHY a recovery kind was chosen.

/**
 * The SINGLE health signal that drove classification. Derived from the KIND
 * classifyFromHealth returned (a pure mapping — it cannot drift from the
 * classifier's decision order, because it never re-implements it).
 */
export function preflightStructuralReason(kind: SyncErrorKind | null): string {
  switch (kind) {
    case "missing_git_dir":
      return "health.missingGitDir";
    case "stale_lock":
      return "health.hasStaleLock";
    case "interrupted_merge":
      return "health.hasInterruptedMerge";
    case "interrupted_rebase":
      return "health.hasInterruptedRebase";
    case "interrupted_cherry_pick":
      return "health.hasInterruptedCherryPick";
    case "detached_head":
      return "health.isDetachedHead";
    case null:
      return "none";
    default:
      // Kinds that cannot come from a health-only classification.
      return "none";
  }
}

/**
 * Build a flat, secret-free record of the preflight decision inputs for the
 * operation log. Every health boolean is recorded (so support can see the FULL
 * picture, not just the one-word kind), plus the opened dir vs repo root, the
 * chosen kind, and the single reason that drove it.
 */
export function buildPreflightDiagnostics(
  openedDir: string,
  repoDir: string,
  health: RepoHealth,
  kind: SyncErrorKind | null,
): LogData {
  return {
    openedDir,
    repoDir,
    repoRootDiffers: repoDir !== openedDir,
    kind: kind ?? "none",
    reason: preflightStructuralReason(kind),
    hasGitDir: health.hasGitDir,
    hasInterruptedMerge: health.hasInterruptedMerge,
    hasInterruptedRebase: health.hasInterruptedRebase,
    hasInterruptedCherryPick: health.hasInterruptedCherryPick,
    hasStaleLock: health.hasStaleLock,
    isDetachedHead: health.isDetachedHead,
    hasLocalChanges: health.hasLocalChanges,
  };
}
