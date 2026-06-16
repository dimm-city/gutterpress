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
  if (code === "PushRejectedError") return true;
  if (code === "GitPushError") {
    const msg = (e as Error)?.message ?? "";
    return /non-fast-forward|would not be a fast-forward/i.test(msg);
  }
  return false;
}

function isMergeConflictError(e: unknown): boolean {
  return (e as { code?: string })?.code === "MergeConflictError";
}

function classifyTransportFailure(e: unknown): "auth_required" | "network_unavailable" | null {
  const err = e as { code?: string; data?: { statusCode?: number }; message?: string };
  if (err?.code === "HttpError") {
    const status = err.data?.statusCode;
    if (status === 401 || status === 403 || status === 404) return "auth_required";
  }
  const msg = err?.message ?? String(e);
  if (/\b401\b|\b403\b|\b404\b|unauthorized|authentication|not authorized/i.test(msg)) {
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
// A MergeConflictError is binary when every conflicted file has a known binary
// extension or when the error carries a `bothModified` list that matches known
// binary patterns. This is best-effort; the recovery handler will also verify.

const BINARY_EXTS = /\.(png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|zip|tar|gz|7z|bin|ico|ttf|otf|woff2?|mp4|mp3|mov|avi|wav|flac)$/i;

function isBinaryConflict(e: unknown): boolean {
  if (!isMergeConflictError(e)) return false;
  const data = (e as { data?: { filepaths?: string[] } })?.data;
  const paths = data?.filepaths ?? [];
  if (paths.length === 0) return false;
  return paths.every((p) => BINARY_EXTS.test(p));
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

// ── Missing objects heuristic ─────────────────────────────────────────────────

function isMissingObjects(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "ReadObjectFail" ||
    code === "ObjectTypeError" ||
    code === "MissingParameterError" ||
    /object not found|missing object|pack.*corrupt|bad object/i.test(msg)
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
 * Health facts (from inspectRepo) upgrade certain generic error codes to the
 * more specific structural kinds (e.g. a generic checkout failure on a repo
 * with `isDetachedHead=true` classifies as `detached_head`).
 */
export function classifyGitError(err: unknown, health?: RepoHealth): SyncErrorKind {
  // ── Repo-health structural failures (highest priority) ──────────────────
  if (health) {
    if (!health.hasGitDir) return "missing_git_dir";
    if (health.isDetachedHead) return "detached_head";
    if (health.hasStaleLock) return "stale_lock";
  }

  // ── isomorphic-git / transport error codes ───────────────────────────────
  if (isPushRejected(err)) return "non_fast_forward";

  if (isMergeConflictError(err)) {
    return isBinaryConflict(err) ? "binary_conflict" : "merge_conflict";
  }

  const transport = classifyTransportFailure(err);
  if (transport) return transport;

  if (isCorruptIndex(err)) return "corrupt_index";
  if (isUnrelatedHistories(err)) return "unrelated_histories";
  if (isMissingObjects(err)) return "missing_or_corrupt_objects";
  if (isWrongRemoteOrBranch(err)) return "wrong_remote_or_branch";

  // ── Stale lock from health ────────────────────────────────────────────────
  const code = (err as { code?: string })?.code;
  if (code === "InternalError" && health?.hasStaleLock) return "stale_lock";

  return "unknown";
}
