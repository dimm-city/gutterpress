/**
 * Error-to-kind classifier for the sync-recovery subsystem — the SINGLE
 * source of truth for git error classification.
 *
 * Maps a thrown error (from isomorphic-git or sync.ts) plus an optional
 * RepoHealth preflight to a SyncErrorKind. The building blocks
 * (isPushRejected, isMergeConflictError, classifyTransportFailure) are
 * exported and consumed by sync.ts — there is exactly ONE implementation of
 * each decoder, not parallel copies "kept in sync by spec".
 *
 * classifyFromHealth() is the health-only classifier used by preflight
 * callers (no thrown error yet — e.g. the viewer at project-open): it returns
 * null for a healthy repo so the caller can skip recovery entirely.
 *
 * This module is pure — no I/O, no side effects.
 */

import type { RepoHealth, SyncErrorKind } from "./types.ts";

/**
 * Minimum age before a leftover git lock counts as STALE for a preflight
 * classification. recover-stale-lock.ts imports this same constant as its
 * act-or-retry threshold, so preflight and handler can never disagree: a lock
 * young enough to pass preflight is exactly a lock the handler would defer
 * with retry_later ("a live process may still hold it").
 */
export const STALE_LOCK_MIN_AGE_MS = 2 * 60 * 1000; // 2 minutes

// ── RepoNeedsRecoveryError ────────────────────────────────────────────────────

/**
 * Thrown by syncProject's structural preflight when the repo must be repaired
 * before any sync work can safely run. The `code` string is the STABLE
 * contract hosts may match on across the dynamic-import boundary (where
 * `instanceof` is unreliable); `kind` names the repair to dispatch.
 */
export class RepoNeedsRecoveryError extends Error {
  readonly code = "RepoNeedsRecovery";
  constructor(readonly kind: SyncErrorKind) {
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
 * surfaced as a 401 → "auth" → "reconnect" loop, and recover-auth then deleted
 * the credential for the whole host. The `code` string is the STABLE contract
 * (matchable across dynamic-import boundaries where `instanceof` fails).
 */
export class InsecureTransportError extends Error {
  readonly code = "InsecureTransport";
  constructor() {
    // No literal scheme tokens ("http://") in this copy: the viewer redacts
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

// ── Shared isomorphic-git error decoders (also used by sync.ts) ──────────────

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

/** Type guard exposing MergeConflictError's per-file payload (used by sync.ts). */
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

export function classifyTransportFailure(
  e: unknown,
): "auth_required" | "network_unavailable" | "insecure_transport" | null {
  // FIRST: the withheld-cleartext-credential error. It must never fall through
  // to the auth arm — "reconnect" can't fix an http:// address, and the auth
  // recovery path deletes the stored credential for the whole host.
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

// ── isBinaryConflict heuristic ───────────────────────────────────────────────
// A MergeConflictError is binary when ANY conflicted file looks binary. We
// route to the binary-aware outcome if even ONE file is binary, because a
// MIXED conflict (e.g. one .png + one .md) must take the binary-safe path —
// the text merge driver corrupts a binary file's bytes via UTF-8 round-trip,
// and the byte-correct safeguard in sync.ts's resolveConflicts only matters
// once the binary-aware handling is engaged. This is best-effort; the recovery
// handler will also verify. (resolveConflicts is additionally binary-safe for
// EVERY decided file regardless of this classification — see its postBinaryFixes
// pass — so a binary file in an otherwise-text conflict can never be corrupted.)

const BINARY_EXTS = /\.(png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|zip|tar|gz|7z|bin|ico|ttf|otf|woff2?|mp4|mp3|mov|avi|wav|flac)$/i;

function isBinaryConflict(e: unknown): boolean {
  if (!isMergeConflictError(e)) return false;
  const data = (e as { data?: { filepaths?: string[] } })?.data;
  const paths = data?.filepaths ?? [];
  if (paths.length === 0) return false;
  return paths.some((p) => BINARY_EXTS.test(p));
}

// ── Unrelated histories heuristic ────────────────────────────────────────────

function isUnrelatedHistories(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "MergeNotSupportedError" ||
    /unrelated histories|no common commits|refusing to merge unrelated/i.test(msg)
  );
}

// ── Missing objects / ref-store corruption heuristic ─────────────────────────
//
// Covers two closely-related local-repo corruptions that BOTH need the same
// "fetch from the remote and rebuild, verifying afterwards" recovery:
//   1. Missing/corrupt OBJECTS (a packfile or loose object can't be read).
//   2. Missing/corrupt REF STORE (a missing/corrupt `.git/HEAD` or
//      `.git/packed-refs`, or any resolveRef failure).
//
// WHY ref-store corruption maps to `missing_or_corrupt_objects` (BUG 4):
// there is no dedicated SyncErrorKind for a broken ref store, and the closest
// EXISTING kind is `missing_or_corrupt_objects` — its handler re-fetches from
// the remote and verifies, which is exactly the safe repair for a clobbered
// HEAD/packed-refs too (the remote-tracking refs and objects come back, and
// HEAD can be re-pointed at the recovered branch). Crucially this avoids the
// WRONG outcome of `missing_git_dir` (whose handler would try to CLONE and
// talk about "setting up a remote" when the repo and its remote already exist
// — only the ref store is damaged). NOTE on NotFoundError ambiguity: a
// TRANSPORT 404 also surfaces as NotFoundError, but sync.ts's fetchRemoteTip
// rewrites those to an HttpError(401) BEFORE they reach this classifier, so a
// raw NotFoundError here is a LOCAL ref-resolution failure — classify it
// structurally, never as auth.

function isRefStoreCorruption(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    // A bare NotFoundError reaching us is a local resolveRef failure (the
    // transport-404 case is rewritten to HttpError upstream).
    (code === "NotFoundError" && /could not find/i.test(msg)) ||
    // Message-level signatures for HEAD / packed-refs / resolveRef problems.
    /could not find head|resolveref|packed-refs|packed refs|head.*(missing|corrupt|not found)|(missing|corrupt|invalid).*head/i.test(
      msg,
    )
  );
}

function isMissingObjects(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "ReadObjectFail" ||
    code === "ObjectTypeError" ||
    code === "MissingParameterError" ||
    /object not found|missing object|pack.*corrupt|bad object/i.test(msg) ||
    isRefStoreCorruption(e)
  );
}

// ── Corrupt index heuristic ───────────────────────────────────────────────────

function isCorruptIndex(e: unknown): boolean {
  const msg = (e as Error)?.message ?? String(e);
  return /corrupt.*index|index.*corrupt|invalid index/i.test(msg);
}

// ── Wrong remote / branch heuristic ──────────────────────────────────────────

function isWrongRemoteOrBranch(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "NoRefspecError" ||
    code === "ExpandRefError" ||
    /branch.*not found|no such ref|remote.*not configured|unknown branch/i.test(msg)
  );
}

// ── Health-only classifier (preflight) ────────────────────────────────────────

/**
 * Classify a structural repo condition from a RepoHealth snapshot alone.
 * Used by preflight callers (no thrown error — e.g. project-open), and by
 * classifyGitError's structural step so there is ONE ordering, not two.
 *
 * Returns null for a healthy repo (nothing to recover).
 *
 * ORDERING: interrupted-operation checks MUST precede the detached-head check
 * (an in-progress rebase usually detaches HEAD — the abort repair must win over
 * the rescue-branch repair), and specific interrupted-op repairs precede the
 * generic stale-lock cleanup.
 *
 * `minLockAgeMs` gates the stale-lock classification: at preflight (the
 * default, STALE_LOCK_MIN_AGE_MS) a younger lock is treated as healthy because
 * a live process may still hold it — the same rule recover-stale-lock.ts
 * applies before acting. Error-path callers pass 0: a lock that just made a
 * sync THROW is worth routing regardless of age (the handler still re-checks
 * and returns retry_later while it is fresh).
 */
export function classifyFromHealth(
  health: RepoHealth,
  opts: { minLockAgeMs?: number } = {},
): SyncErrorKind | null {
  const minLockAgeMs = opts.minLockAgeMs ?? STALE_LOCK_MIN_AGE_MS;
  if (!health.hasGitDir) return "missing_git_dir";
  if (health.hasInterruptedRebase) return "interrupted_rebase";
  if (health.hasInterruptedCherryPick) return "interrupted_cherry_pick";
  // An abandoned native-git merge (MERGE_HEAD + conflict markers in tracked
  // files) must be caught BEFORE any sync work: left unclassified it falls
  // through to "unknown" and — worse — the next sync would snapshot the
  // literal conflict markers into history and push them.
  if (health.hasInterruptedMerge) return "interrupted_merge";
  // headUnreadable (HEAD/ref store missing or corrupt) must be checked BEFORE
  // isDetachedHead: currentBranch() throwing sets headUnreadable, not
  // isDetachedHead (see inspectRepo), but route both here defensively so a
  // stale/hand-built health snapshot with both flags set still gets the
  // correct (more severe) repair.
  if (health.headUnreadable) return "missing_or_corrupt_objects";
  if (health.isDetachedHead) return "detached_head";
  if (health.hasStaleLock && (health.lockAgeMs ?? 0) >= minLockAgeMs) {
    return "stale_lock";
  }
  return null;
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Map a thrown error plus optional repo-health facts to a SyncErrorKind.
 *
 * Called by the recovery dispatcher BEFORE invoking the per-kind handler.
 *
 * ORDERING (BUG 1 — transient transport beats structural health):
 *   1. missing_git_dir — when there is genuinely no repo, a transport error is
 *      meaningless (nothing to talk to a remote ABOUT), so the missing-repo
 *      guidance must win even over an auth/network error.
 *   2. Clearly transient/transport errors (auth, network) — these are decoded
 *      from the THROWN ERROR and win over the remaining structural health
 *      flags (detached HEAD, stale lock). Rationale: you cannot repair repo
 *      STRUCTURE while you are offline or signed out, and the scary
 *      backup+rescue-branch+confirm repair is the wrong first response to a
 *      blip — the friendly "reconnect" / "try later" is correct. Once the user
 *      is back online, the next sync re-runs preflight (no thrown error) and
 *      the structural kind surfaces then (step 3).
 *   3. Structural health flags (detached HEAD, stale lock) — applied when the
 *      failure is NOT a transient transport error (e.g. a preflight with no
 *      error, or a non-transport error).
 *   4. Remaining error-code/message heuristics (conflicts, corrupt index,
 *      unrelated histories, missing objects/ref-store, wrong remote/branch).
 */
export function classifyGitError(err: unknown, health?: RepoHealth): SyncErrorKind {
  // (0) A preflight rejection already CARRIES its classification — use it
  //     verbatim rather than re-deriving it from health.
  if (isRepoNeedsRecoveryError(err)) return err.kind;

  // (1) No repo at all — highest priority; a transport error is meaningless
  //     when there is no .git to sync.
  if (health && !health.hasGitDir) return "missing_git_dir";

  // (2) Clearly transient transport errors beat the remaining structural
  //     health flags — you can't fix structure while offline/signed out.
  const transport = classifyTransportFailure(err);
  if (transport) return transport;

  // (3) Structural health (only after a transport error has been ruled out).
  //     Same single ordering as the preflight path — see classifyFromHealth.
  //     minLockAgeMs 0: a lock that just made a sync throw is worth routing
  //     regardless of age (the handler re-checks and defers while fresh).
  if (health) {
    const structural = classifyFromHealth(health, { minLockAgeMs: 0 });
    if (structural) return structural;
  }

  // (4) Remaining isomorphic-git error-code / message heuristics.
  if (isPushRejected(err)) return "non_fast_forward";

  if (isMergeConflictError(err)) {
    return isBinaryConflict(err) ? "binary_conflict" : "merge_conflict";
  }

  if (isCorruptIndex(err)) return "corrupt_index";
  if (isUnrelatedHistories(err)) return "unrelated_histories";
  if (isMissingObjects(err)) return "missing_or_corrupt_objects";
  if (isWrongRemoteOrBranch(err)) return "wrong_remote_or_branch";

  return "unknown";
}
