/**
 * Error/health classification for sync + repair — the SINGLE source of truth.
 *
 * 2026-08-14 simplification (owner directive): the 17-kind SyncErrorKind
 * taxonomy and its 16 per-kind handlers are gone. Every structural problem a
 * repo can have now has ONE answer — `repairRepo()` (repair.ts) — so
 * classification collapses to three health verdicts:
 *
 *   - null           — healthy, nothing to do
 *   - "stale_lock"   — a leftover lock old enough to sweep
 *   - "needs_repair" — anything structural (missing/corrupt `.git`, broken
 *                      ref store, detached HEAD, interrupted merge/rebase/
 *                      cherry-pick left by an external tool)
 *
 * The transport decoders (auth/offline/insecure) and the merge/push guards
 * now live with the modules that own them — transport.ts, sync.ts and
 * converge-merge.ts — because they map OUTCOMES, not repair.
 * This module is pure — no I/O, no side effects.
 */

import { classifyTransportFailure } from "../transport.ts";
import type { RepoHealth } from "./types.ts";

/**
 * Minimum age before a leftover git lock counts as STALE. locks.ts imports
 * this same constant as its sweep threshold, so preflight and sweep can never
 * disagree: a lock young enough to pass preflight is exactly a lock the sweep
 * would defer ("a live process may still hold it").
 */
export const STALE_LOCK_MIN_AGE_MS = 2 * 60 * 1000; // 2 minutes

/** The collapsed repair taxonomy — see the module header. */
export type RepairNeed = "stale_lock" | "needs_repair";

// ── RepoNeedsRecoveryError ────────────────────────────────────────────────────

/**
 * Thrown by sync's structural preflight when the repo must be repaired before
 * any sync work can safely run. The `code` string is the STABLE contract
 * hosts may match on across the dynamic-import boundary (where `instanceof`
 * is unreliable); `kind` says whether a lock sweep suffices or the full
 * repair pipeline is needed.
 */
export class RepoNeedsRecoveryError extends Error {
  readonly code = "RepoNeedsRecovery";
  constructor(readonly kind: RepairNeed) {
    super(`The project needs repair before it can sync (${kind}).`);
    this.name = "RepoNeedsRecoveryError";
  }
}

/** Type guard for {@link RepoNeedsRecoveryError} (matches on the stable code). */
export function isRepoNeedsRecoveryError(e: unknown): e is RepoNeedsRecoveryError {
  return (e as { code?: string })?.code === "RepoNeedsRecovery";
}

/**
 * True when a thrown error smells like LOCAL repo corruption (unreadable
 * objects/refs/index) rather than a transport or logic failure — the signal
 * for a host's mid-sync catch to run `repairRepo()`. NOTE on NotFoundError
 * ambiguity: a transport 404 also surfaces as NotFoundError, but
 * transport.ts's fetchRemoteTip rewrites those to an HttpError(401) BEFORE
 * they can reach this heuristic, so a raw NotFoundError here is a LOCAL
 * ref-resolution failure.
 */
export function isLikelyRepoCorruption(e: unknown): boolean {
  if (classifyTransportFailure(e)) return false;
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "ReadObjectFail" ||
    code === "ObjectTypeError" ||
    (code === "NotFoundError" && /could not find/i.test(msg)) ||
    /object not found|missing object|pack.*corrupt|bad object|corrupt.*index|index.*corrupt|invalid index|could not find head|packed-refs/i.test(
      msg,
    )
  );
}

// ── Health-only classifier ───────────────────────────────────────────────────

/**
 * Classify a repo's structural condition from a RepoHealth snapshot.
 * Returns null for a healthy repo, "stale_lock" when the only problem is a
 * sweepable lock, and "needs_repair" for everything structural — the repair
 * pipeline (repair.ts) handles every structural case in one ordered pass, so
 * finer distinctions buy nothing.
 *
 * `minLockAgeMs` gates the stale-lock verdict: at preflight (the default) a
 * younger lock is treated as healthy because a live process may still hold
 * it. Error-path callers pass 0: a lock that just made a sync THROW is worth
 * routing regardless of age (the sweep still defers while it is fresh).
 */
export function classifyFromHealth(
  health: RepoHealth,
  opts: { minLockAgeMs?: number } = {},
): RepairNeed | null {
  const minLockAgeMs = opts.minLockAgeMs ?? STALE_LOCK_MIN_AGE_MS;
  if (!health.hasGitDir) return "needs_repair";
  // An abandoned operation another git tool left behind (MERGE_HEAD,
  // rebase-merge/, CHERRY_PICK_HEAD). A merge in particular must be caught
  // BEFORE any sync work: left unclassified, the next sync would snapshot the
  // literal conflict markers into history and push them to every collaborator.
  if (health.interruptedOperation) return "needs_repair";
  if (health.headUnreadable) return "needs_repair";
  if (health.isDetachedHead) return "needs_repair";
  if (health.hasStaleLock && (health.lockAgeMs ?? 0) >= minLockAgeMs) {
    return "stale_lock";
  }
  return null;
}
