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
 * used by sync.ts remain here unchanged — outcome mapping, not repair.
 * This module is pure — no I/O, no side effects.
 */

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

// ── InsecureTransportError ───────────────────────────────────────────────────

/**
 * Thrown by transport.ts's onAuth when a stored credential EXISTS but the
 * remote URL fails isCredentialTransmissionSafe (non-loopback http). Loud and
 * typed on purpose: the old behavior (silently withholding the credential)
 * surfaced as a 401 → "auth" → "reconnect" loop. The `code` string is the
 * STABLE contract (matchable across dynamic-import boundaries).
 */
export class InsecureTransportError extends Error {
  readonly code = "InsecureTransport";
  constructor() {
    // No literal scheme tokens ("http://") in this copy: the desktop redacts
    // anything matching /https?:\/\/\S+/, which would garble the message.
    super(
      "This online address isn't secure, so the saved connection wasn't sent — " +
        "connections are never sent over an insecure address. Switch the address " +
        "to a secure one (starting with https) to sync with a saved connection.",
    );
    this.name = "InsecureTransportError";
  }
}

/** Type guard for {@link InsecureTransportError} (matches on the stable code). */
export function isInsecureTransportError(e: unknown): e is InsecureTransportError {
  return (e as { code?: string })?.code === "InsecureTransport";
}

// ── Shared isomorphic-git error decoders (used by sync.ts) ───────────────────

export function isPushRejected(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  // PushRejectedError carries a typed `data.reason`. ONLY a genuine
  // non-fast-forward ("not-fast-forward") is fixable by pulling first; other
  // reasons (e.g. "tag-exists") are not and must fall through to the friendly
  // auth/error classifier. Treat a reason-less PushRejectedError as the
  // historical non-fast-forward (back-compat — that is what it meant before
  // isomorphic-git started attaching a reason).
  if (code === "PushRejectedError") {
    const reason = (e as { data?: { reason?: string } })?.data?.reason;
    return reason === undefined || reason === "not-fast-forward";
  }
  // Server-side rejection arrives as GitPushError; only the report-status line
  // that actually says non-fast-forward is a pull-first situation. A
  // permission/hook decline ("permission denied", "pre-receive hook declined",
  // …) must NOT be treated as a non-fast-forward.
  if (code === "GitPushError") {
    const msg =
      ((e as { data?: { prettyDetails?: string } })?.data?.prettyDetails ?? "") +
      " " +
      ((e as Error)?.message ?? "");
    return /non-fast-forward|would not be a fast-forward|not a simple fast-forward/i.test(
      msg,
    );
  }
  return false;
}

/** Type guard exposing MergeConflictError's per-file payload (converge-merge). */
export function isMergeConflictError(
  e: unknown,
): e is {
  data: {
    filepaths: string[];
    bothModified: string[];
    deleteByUs: string[];
    deleteByTheirs: string[];
  };
} {
  return (e as { code?: string })?.code === "MergeConflictError";
}

/**
 * A non-forced `git.checkout` refused to overwrite working-tree files whose
 * content moved after we committed them (converge-merge). isomorphic-git
 * detects this in its analysis pass and throws BEFORE touching the tree, so
 * the refusal is atomic: nothing on disk has been written.
 */
export function isCheckoutConflict(e: unknown): boolean {
  return (e as { code?: string })?.code === "CheckoutConflictError";
}

/**
 * Unrelated histories — the local project and the configured online project
 * share no common starting point. Sync surfaces this as a plain setup error
 * (a wrong online address must never be silently spliced into the book).
 */
export function isUnrelatedHistories(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "MergeNotSupportedError" ||
    /unrelated histories|no common commits|refusing to merge unrelated/i.test(msg)
  );
}

export function classifyTransportFailure(
  e: unknown,
): "auth_required" | "network_unavailable" | "insecure_transport" | null {
  // FIRST: the withheld-cleartext-credential error. It must never fall through
  // to the auth arm — "reconnect" can't fix an http:// address.
  if (isInsecureTransportError(e)) return "insecure_transport";
  const err = e as { code?: string; data?: { statusCode?: number; prettyDetails?: string }; message?: string };
  if (err?.code === "HttpError") {
    const status = err.data?.statusCode;
    if (status === 401 || status === 403 || status === 404) return "auth_required";
  }
  // For a server-side push rejection (GitPushError), the useful detail is in
  // `data.prettyDetails` (the per-ref report-status text), so fold it into the
  // text we scan — a "permission denied"/"forbidden"/hook-declined rejection is
  // an AUTH/permission problem the user fixes by reconnecting, NOT a
  // non-fast-forward (which is handled separately by isPushRejected).
  const msg = `${err?.message ?? String(e)} ${err?.data?.prettyDetails ?? ""}`;
  if (
    /\b401\b|\b403\b|\b404\b|unauthorized|authentication|not authorized|permission denied|forbidden|access denied|not allowed to push|pre-receive hook declined|hook declined/i.test(
      msg,
    )
  ) {
    return "auth_required";
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|fetch failed|couldn't reach|socket hang ?up/i.test(
      msg,
    )
  ) {
    return "network_unavailable";
  }
  return null;
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
