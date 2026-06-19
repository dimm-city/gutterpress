/**
 * recover-stale-lock.ts — remove stale .git lock files left by a crash.
 *
 * WHY: When a write operation is interrupted (power loss, forced kill, crash)
 * the version-tracking system leaves a lock file behind. Every subsequent
 * operation fails until the lock is removed. This handler automates that
 * cleanup with a conservative age check and a user confirmation gate.
 *
 * A crash does NOT only leave `.git/index.lock`. Depending on what was being
 * written when the process died, git can leave any of:
 *   - index.lock          (staging the index)
 *   - HEAD.lock           (moving HEAD)
 *   - config.lock         (writing config)
 *   - packed-refs.lock    (repacking refs)
 *   - refs/**\/<name>.lock (updating a single ref, e.g. refs/heads/main.lock)
 * If the stuck lock is any of these and we only ever looked at index.lock, the
 * repo would stay unusable forever. So this handler scans the known top-level
 * lock files PLUS a shallow scan of `.git/refs/**` for `*.lock` files.
 *
 * Decision logic (applied to the WHOLE candidate set, not just index.lock):
 *   NO lock at all → the race was already won; return retry_later (safe to
 *     retry the original operation immediately).
 *   ANY lock is FRESH (age < STALE_THRESHOLD_MS) → a live process may still
 *     hold the repo. Deleting a lock another process holds would corrupt an
 *     in-flight write, so we delete NOTHING and return retry_later — even if
 *     other locks in the set are stale. One fresh lock blocks the whole sweep.
 *   ALL locks are STALE (age ≥ STALE_THRESHOLD_MS) → request user confirmation
 *     once, then remove every stale lock; return recovered.
 *
 * Why "any fresh → retry_later" (and not "remove the stale ones"): the locks
 * in the set may belong to the SAME interrupted-or-live operation. We cannot
 * tell a crashed lock from a live one except by age, so the safe rule is: if
 * the youngest lock could still be held, leave them all alone for now.
 *
 * Safety invariants:
 *   - Never force-pushes (this repair is entirely local).
 *   - No backup zip (policy.createBackup = false for stale_lock; a lock file
 *     is trivially recreatable and contains no user data).
 *   - Confirmation required (policy.requireConfirmation = true).
 *   - Fault hook ctx.faults?.before("remove_index_lock") fires once, just
 *     before the FIRST unlink, so tests can assert the fail-safe path. If it
 *     throws, nothing is removed.
 *   - Only locks proven stale are removed; a fresh lock is never touched.
 *   - User content files are never touched.
 *
 * Author-facing copy lives in manual-guidance.ts (stale_lock case). No git
 * words, no file paths, no tokens in any user-visible string — the copy here
 * says "leftover lock" / "temporary lock", never "lock file"/"index"/"ref".
 */

import * as fs from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { gitDirFor } from "../../source-provider.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { policyFor } from "./policy.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * A lock younger than this is considered "fresh" — another process may still
 * hold it. 2 minutes is the conservative safe minimum (most git operations
 * complete in under 10 seconds; 2 min gives a wide margin for slow machines).
 *
 * NOTE: kept at exactly 2 minutes (120_000 ms). The viewer's preflight uses the
 * same magnitude; do not change it without updating that constant in lockstep.
 */
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes (120_000 ms)

/**
 * Known top-level lock files git may leave directly under `.git/`. These are
 * scanned in addition to a shallow walk of `.git/refs/**` for `*.lock` files.
 */
const TOP_LEVEL_LOCK_NAMES = [
  "index.lock",
  "HEAD.lock",
  "config.lock",
  "packed-refs.lock",
] as const;

// ── Lock discovery ──────────────────────────────────────────────────────────

interface LockCandidate {
  /** Absolute path to the lock file. */
  path: string;
  /** Age in ms relative to `now` (now - mtime). */
  ageMs: number;
}

/**
 * Recursively collect `*.lock` file paths under a directory. Best-effort and
 * never throws — an unreadable subdirectory is skipped. Used to find per-ref
 * locks like `refs/heads/main.lock` or `refs/tags/v1.lock` at any depth.
 */
async function collectRefLockPaths(dir: string, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Missing/unreadable — nothing to collect here.
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRefLockPaths(abs, out);
    } else if (entry.isFile() && entry.name.endsWith(".lock")) {
      out.push(abs);
    }
  }
}

/**
 * Gather every candidate lock file (top-level + refs/**) with its age.
 * Locks that vanish between discovery and stat are simply dropped (a racing
 * delete is fine to ignore). Never throws.
 */
async function findLockCandidates(gitDir: string, now: number): Promise<LockCandidate[]> {
  const paths: string[] = TOP_LEVEL_LOCK_NAMES.map((name) => path.join(gitDir, name));
  await collectRefLockPaths(path.join(gitDir, "refs"), paths);

  const candidates: LockCandidate[] = [];
  for (const p of paths) {
    try {
      const s = await stat(p);
      if (s.isFile()) candidates.push({ path: p, ageMs: now - s.mtimeMs });
    } catch {
      // Not present (or unreadable) — skip.
    }
  }
  return candidates;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Attempt to recover from stale .git lock files (index.lock and friends).
 *
 * Implements the RecoverFn contract from types.ts.
 */
export async function recover(
  ctx: RecoveryContext,
  _error?: unknown,
): Promise<RecoveryResult> {
  const kind = "stale_lock" as const;
  const policy = policyFor(kind);
  const now = ctx.now ? ctx.now() : Date.now();
  const gitDir = gitDirFor(ctx.repoDir);

  // ── Discover all candidate lock files and their ages ──────────────────────
  const candidates = await findLockCandidates(gitDir, now);

  // ── No lock at all: the race was already won — safe to retry immediately ──
  if (candidates.length === 0) {
    return {
      status: "retry_later",
      message:
        "The temporary lock is no longer there. You can try again right away.",
      retryAfterMs: 0,
    };
  }

  // ── Any fresh lock: a live process may still hold it — touch nothing ──────
  //
  // Use the YOUNGEST lock's age to decide: if even one lock could still be held
  // by a running operation, deleting any of them risks corrupting that write.
  // We back off for the remaining time until the youngest lock would be stale.
  const youngestAge = Math.min(...candidates.map((c) => c.ageMs));
  if (youngestAge < STALE_THRESHOLD_MS) {
    return {
      status: "retry_later",
      message:
        "Another operation is in progress. Try again in a moment.",
      retryAfterMs: STALE_THRESHOLD_MS - youngestAge,
    };
  }

  // From here every candidate is stale (≥ threshold) and eligible for removal.

  // ── Stale lock(s): ask the user before removing ───────────────────────────
  if (policy.requireConfirmation) {
    const guidance = makeManualGuidance(ctx, kind, undefined, undefined);
    const approved = await ctx.confirmation.confirmRepair({
      repair: kind,
      risk: policy.risk,
      summary: guidance.recommendedNextStep,
      backupZipPath: "", // no backup for stale_lock
      willChangeLocalFiles: policy.mayChangeLocalFiles,
      willChangeGitMetadata: policy.mayChangeGitMetadata,
      willChangeRemote: policy.mayChangeRemote,
      canBeUndoneFromBackup: false,
    });

    if (!approved) {
      const blockedGuidance = makeManualGuidance(ctx, kind, undefined, undefined);
      return {
        status: "blocked",
        message: "The repair was cancelled. Nothing was changed.",
        guidance: blockedGuidance,
        // No backupZipPath — policy.createBackup is false.
      };
    }
  }

  // ── Remove every stale lock file ──────────────────────────────────────────
  //
  // The fault hook fires ONCE before the first unlink so an injected failure
  // (or a real fs error) leaves the whole set in place and reports a no-op.
  try {
    await ctx.faults?.before("remove_index_lock");
    for (const candidate of candidates) {
      // Tolerate a lock that vanished since discovery (another process cleaned
      // it up) — its absence is the desired end state, not an error.
      try {
        await unlink(candidate.path);
      } catch (perFileErr) {
        if (fs.existsSync(candidate.path)) throw perFileErr;
      }
    }
  } catch (removeErr) {
    // Removal failed. No backup was created (createBackup=false), so the result
    // is failed_no_changes_made.
    const guidance = makeManualGuidance(ctx, kind, removeErr, undefined);
    return {
      status: "failed_no_changes_made",
      message: guidance.userSummary,
      guidance,
    };
  }

  // Verify the locks are gone (defensive — unlink should have thrown on failure).
  const stillPresent = candidates.find((c) => fs.existsSync(c.path));
  if (stillPresent) {
    const guidance = makeManualGuidance(
      ctx,
      kind,
      new Error("a leftover lock was still present after removal"),
      undefined,
    );
    return {
      status: "failed_no_changes_made",
      message: guidance.userSummary,
      guidance,
    };
  }

  return {
    status: "recovered",
    message:
      "The leftover lock was removed. You can try syncing again.",
    // No backupZipPath — policy.createBackup is false.
  };
}
