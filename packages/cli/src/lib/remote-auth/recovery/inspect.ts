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
 *   - hasStaleLock uses the lock sweep's OWN scanner
 *     (findLockCandidates in locks.ts) — one implementation, so
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
import { findLockCandidates } from "./locks.ts";
import type { RepairNeed } from "./classify.ts";
import type { RepoHealth } from "./types.ts";

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
  ctx: { repoDir: string; source?: import("../../project-source.ts").ProjectSource },
  opts: { checkLocalChanges?: boolean } = {},
): Promise<RepoHealth> {
  // CRITICAL: resolve the ACTUAL git root. A project is often opened at a
  // SUBFOLDER of its repo ("opening a subfolder syncs the whole repo"), so
  // checking the raw opened dir for `.git` would false-positive `missing_git_dir`
  // on every such project — which then runs the destructive missing-history
  // recovery (and OOMs zipping a large `.git`). Use the SAME resolution as the
  // sync path (detectProjectSource → gitScopeFor) so health and sync agree.
  // A context built by buildRecoveryContext already carries that classification
  // (ctx.source) — reuse it instead of re-walking parent dirs (#87); a bare
  // `{repoDir}` caller still classifies here.
  // Genuine missing-git (no `.git` anywhere up the tree) classifies as
  // local-folder, so repoDir stays the opened dir and hasGitDir is correctly
  // false — the real recovery case is preserved.
  let repoDir = ctx.repoDir;
  try {
    const source = ctx.source ?? (await detectProjectSource(ctx.repoDir));
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
      headUnreadable: false,
      hasStaleLock: false,
      hasInterruptedMerge: false,
      hasInterruptedRebase: false,
      hasInterruptedCherryPick: false,
      hasLocalChanges: false,
    };
  }

  // ── Detached HEAD ────────────────────────────────────────────────────────
  //
  // git.currentBranch() has two distinct failure shapes that must NOT be
  // conflated:
  //   - Returns `undefined`/`null` — HEAD resolves fine but points directly
  //     at a commit rather than a branch ref. This IS a clean detached HEAD.
  //   - THROWS — HEAD (or the ref store) could not even be read (missing or
  //     corrupt `.git/HEAD`). This is repo CORRUPTION, not detachment: routing
  //     it to the detached-head repair would try to check out a branch on a
  //     repo whose HEAD can't be trusted. Record it as `headUnreadable`
  //     instead so the classifier can route it to the missing/corrupt-objects
  //     repair (which re-fetches and rebuilds refs).
  let currentBranch: string | undefined;
  let isDetachedHead = false;
  let headUnreadable = false;
  try {
    const branch = await git.currentBranch({ fs, dir: repoDir });
    if (branch == null) {
      isDetachedHead = true;
    } else {
      currentBranch = branch;
    }
  } catch {
    headUnreadable = true;
  }

  // ── Stale lock ────────────────────────────────────────────────────────────
  //
  // Detect EVERY known git lock via the sweep's own scanner —
  // one implementation for health and sweep. lockAgeMs reflects the
  // YOUNGEST lock, matching the sweep's "if any lock is fresh, wait" rule
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
    headUnreadable,
    hasStaleLock,
    lockAgeMs,
    hasInterruptedMerge,
    hasInterruptedRebase,
    hasInterruptedCherryPick,
    hasLocalChanges,
  };
}

// ── Structural readability probe ───────────────────────────────────────────

/**
 * Confirm the repo's object store is actually readable: resolve HEAD, read
 * its commit, and read its root tree. Throws when any step fails (missing or
 * corrupt object/ref); resolves when the repo is fully readable.
 *
 * Exported so the repair
 * command's diagnosis step and any host check share ONE implementation. `inspectRepo`'s health flags are
 * all filesystem-presence checks (no object is ever read), so they cannot
 * detect object-store corruption on their own — callers that need to catch
 * unreadable objects/refs must run this probe and feed a caught error through
 * `isLikelyRepoCorruption` (classify.ts) to decide whether to repairRepo().
 */
export async function verifyRepoReadable(dir: string): Promise<void> {
  const headOid = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const { commit } = await git.readCommit({ fs, dir, oid: headOid });
  await git.readTree({ fs, dir, oid: commit.tree });
}

/**
 * True when HEAD names a branch that simply has no commits yet — a fresh
 * `git init` before the first snapshot. In that state `verifyRepoReadable`
 * throws the SAME NotFoundError as a damaged ref store, but the repo is
 * healthy, not corrupt. The distinguishing signal is the object store: a
 * fresh repo has NO objects at all, while ref damage on a real repo leaves
 * loose objects and/or packfiles behind.
 */
export function isUnbornRepo(repoDir: string): boolean {
  const objectsDir = path.join(gitDirFor(repoDir), "objects");
  let entries: string[];
  try {
    entries = fs.readdirSync(objectsDir);
  } catch {
    return false; // objects/ missing entirely is damage, not newness
  }
  for (const entry of entries) {
    if (/^[0-9a-f]{2}$/.test(entry)) {
      try {
        if (fs.readdirSync(path.join(objectsDir, entry)).length > 0) return false;
      } catch {
        // unreadable fan-out dir — treat as possibly-populated
        return false;
      }
    } else if (entry === "pack") {
      try {
        if (fs.readdirSync(path.join(objectsDir, entry)).some((f) => f.endsWith(".pack"))) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }
  return true;
}

// ── Preflight diagnostics (structured operation-log fields) ───────────────────
// Pure mappers shared by every host that logs WHY a recovery kind was chosen.

/**
 * The SINGLE health signal that drove classification. Derived from the KIND
 * classifyFromHealth returned (a pure mapping — it cannot drift from the
 * classifier's decision order, because it never re-implements it).
 */
export function preflightStructuralReason(kind: RepairNeed | null): string {
  switch (kind) {
    case "stale_lock":
      return "health.hasStaleLock";
    case "needs_repair":
      return "health.structural";
    case null:
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
  kind: RepairNeed | null,
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
