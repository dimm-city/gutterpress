/**
 * Error-to-kind classifier for the sync-recovery subsystem.
 *
 * Maps a thrown error (from isomorphic-git or sync.ts) plus an optional
 * RepoHealth preflight to one of the 13 SyncErrorKind values.
 *
 * Delegation strategy (reuse sync.ts sub-classifiers where possible):
 *   - isPushRejected  → non_fast_forward
 *   - isMergeConflictError → merge_conflict or binary_conflict
 *   - classifyFailure (auth arm) → auth_required
 *   - classifyFailure (offline arm) → network_unavailable
 * All other paths are genuine delta: decoded from error code/message + health.
 *
 * This module is pure — no I/O, no side effects.
 */

import type { RepoHealth, SyncErrorKind } from "./types.ts";

// ── Re-exported isomorphic-git error-code helpers ────────────────────────────
// These parallel the private helpers in sync.ts, kept in sync by spec.

function isPushRejected(e: unknown): boolean {
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

function isMergeConflictError(e: unknown): boolean {
  return (e as { code?: string })?.code === "MergeConflictError";
}

function classifyTransportFailure(e: unknown): "auth_required" | "network_unavailable" | null {
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
  // (1) No repo at all — highest priority; a transport error is meaningless
  //     when there is no .git to sync.
  if (health && !health.hasGitDir) return "missing_git_dir";

  // (2) Clearly transient transport errors beat the remaining structural
  //     health flags — you can't fix structure while offline/signed out.
  const transport = classifyTransportFailure(err);
  if (transport) return transport;

  // (3) Structural health (only after a transport error has been ruled out).
  if (health) {
    // CRITICAL ORDERING: an in-progress rebase usually leaves HEAD detached, so
    // a mid-rebase repo also reports isDetachedHead. The interrupted-operation
    // checks MUST run BEFORE the detached-head check, or the abort-based repair
    // never fires and the repo is sent down the (wrong) detached-head rescue.
    if (health.hasInterruptedRebase) return "interrupted_rebase";
    if (health.hasInterruptedCherryPick) return "interrupted_cherry_pick";
    // An abandoned native-git merge (MERGE_HEAD + conflict markers in tracked
    // files) must be caught BEFORE any sync work: left unclassified it falls
    // through to "unknown" and — worse — the next sync would snapshot the
    // literal conflict markers into history and push them.
    if (health.hasInterruptedMerge) return "interrupted_merge";
    if (health.isDetachedHead) return "detached_head";
    if (health.hasStaleLock) return "stale_lock";
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

  // ── Stale lock from health (InternalError + lock) ─────────────────────────
  const code = (err as { code?: string })?.code;
  if (code === "InternalError" && health?.hasStaleLock) return "stale_lock";

  return "unknown";
}
