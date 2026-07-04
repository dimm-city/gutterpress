/**
 * Type/interface declarations for snapshot-first sync + conflict resolution
 * (#15, ADR 0006 D5). Extracted from sync.ts so the orchestrator, transport and
 * conflict-resolution modules share ONE definition of each result/option shape.
 * Pure type surface — no runtime code.
 */
import type httpNode from "isomorphic-git/http/node";

import type { HostCredential, TokenStore } from "./token-store.ts";

/**
 * isomorphic-git object cache, scoped to ONE operation (one function call)
 * and released with it. NEVER share these across operations or hold them in
 * module state: reading any object from a packfile makes isomorphic-git load
 * the ENTIRE pack into the cache (measured ~1.3–3.8 GB RSS on a 2 GB repo),
 * so a long-lived shared cache pins that memory for the life of the process —
 * the root cause of the 0.5.0 "sync uses 2 GB" report.
 */
export type GitCache = Record<string, unknown>;

// ── Result types ──────────────────────────────────────────────────────────────

/** How one conflicted file differs between the two copies. */
export type ConflictKind =
  /** Edited in both copies. */
  | "both-edited"
  /** The author deleted it; the online copy edited it. */
  | "you-deleted"
  /** The online copy deleted it; the author edited it. */
  | "online-deleted";

/** One file that changed in both the local and the online copy. */
export interface ConflictFile {
  path: string;
  kind: ConflictKind;
}

/** Author's per-file decision for a conflicted file (ADR 0006 D5). */
export interface ConflictResolution {
  path: string;
  choice: "mine" | "theirs" | "both";
}

/** Outcome of a sync (or conflict-resolution) attempt. */
export type SyncOutcome =
  | {
      status: "synced";
      message: string;
      /** Snapshot taken of unsaved work before syncing, if any. */
      snapshotId?: string;
      /** True when online changes were merged into the local copy. */
      mergedRemoteChanges: boolean;
      /** True when pulling online changes changed the local working tree. */
      filesChanged?: boolean;
    }
  | { status: "up-to-date"; message: string; snapshotId?: string; filesChanged?: boolean }
  | {
      status: "conflict";
      message: string;
      files: ConflictFile[];
      /** Local branch tip the conflict was computed against. */
      localId: string;
      /** Online tip the conflict was computed against. */
      remoteId: string;
      snapshotId?: string;
    }
  | { status: "auth"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "offline"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "error"; message: string; snapshotId?: string; filesChanged?: boolean };

/**
 * Outcome of a pull-only attempt ({@link pullChanges}): fetch + fast-forward/
 * merge of the online changes, NEVER a push. Conflict semantics are identical
 * to {@link syncProject} (abortOnConflict — the working tree is never left
 * with conflict markers).
 */
export type PullOutcome =
  | {
      status: "pulled";
      message: string;
      /** Snapshot taken of unsaved work before pulling, if any. */
      snapshotId?: string;
      /**
       * True when the pull created a combine (merge) commit — local commits
       * existed alongside the online ones. False for a plain fast-forward.
       */
      merged: boolean;
      /**
       * True when the working tree CONTENT changed (the tip's tree differs
       * from before) — the host should refresh its preview.
       */
      filesChanged: boolean;
    }
  | { status: "up-to-date"; message: string; snapshotId?: string }
  | {
      status: "conflict";
      message: string;
      files: ConflictFile[];
      localId: string;
      remoteId: string;
      snapshotId?: string;
    }
  | { status: "auth"; message: string; snapshotId?: string }
  | { status: "offline"; message: string; snapshotId?: string }
  | { status: "error"; message: string; snapshotId?: string };

/**
 * Outcome of a push-only attempt ({@link pushChanges}): snapshot-if-needed,
 * then push — NEVER a merge. When the online copy has commits this computer
 * doesn't have, the result is the typed `"pull-first"` status (the host shows
 * a plain-language "get the latest changes first" message) — pushChanges
 * never auto-merges.
 */
export type PushOutcome =
  | { status: "pushed"; message: string; snapshotId?: string }
  | { status: "up-to-date"; message: string; snapshotId?: string }
  | { status: "pull-first"; message: string; snapshotId?: string }
  | { status: "auth"; message: string; snapshotId?: string }
  | { status: "offline"; message: string; snapshotId?: string }
  | { status: "error"; message: string; snapshotId?: string };

// ── Options ──────────────────────────────────────────────────────────────────

export interface SyncProjectOptions {
  projectDir: string;
  /** Explicit credential; wins over the token store. */
  credential?: HostCredential;
  /** Host-keyed store used to resolve the credential for the remote's host. */
  tokenStore?: TokenStore;
  /** Snapshot message for unsaved work (defaults to a friendly one). */
  message?: string;
  authorName?: string;
  authorEmail?: string;
  /** Injectable git HTTP transport for tests. */
  httpClient?: typeof httpNode;
  /**
   * Bounded retry policy for {@link syncProject}'s pull→push race loop. The
   * loop is ALWAYS bounded (never infinite) and the snapshot-first guarantee
   * holds on every path. Defaults to {@link DEFAULT_SYNC_RETRY}. `sleep` is
   * injectable so tests can drive backoff deterministically.
   */
  retry?: SyncRetryOptions;
  /**
   * Optional path to a log file for debugging sync/recovery operations.
   * When set, each step (snapshot, fetch, merge, push, conflict) is appended
   * as a timestamped line. Never logs secrets.
   */
  logFile?: string;
}

/** Bounded retry policy for the sync race loop (BUG 6). */
export interface SyncRetryOptions {
  /** Max pull→push passes before giving up. Clamped to ≥ 1. Default 3. */
  attempts?: number;
  /** Delay between passes, in ms. Clamped to ≥ 0. Default 150. */
  backoffMs?: number;
  /** Injectable delay (tests only); defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolveConflictsOptions {
  projectDir: string;
  resolutions: ConflictResolution[];
  /** The `localId` from the conflict outcome. */
  localId: string;
  /** The `remoteId` from the conflict outcome. */
  remoteId: string;
  credential?: HostCredential;
  tokenStore?: TokenStore;
  authorName?: string;
  authorEmail?: string;
  httpClient?: typeof httpNode;
  /**
   * When true, the merge is allowed to combine two commits that share no
   * common ancestor (unrelated histories). Set by the unrelated-histories
   * recovery path; regular merge conflicts leave this false (the local and
   * remote share a common base, so `allowUnrelatedHistories` is unnecessary).
   */
  allowUnrelatedHistories?: boolean;
  /** Optional log file for debugging conflict resolution steps. */
  logFile?: string;
}

/** Resolved project remote + credential used by every transport call. */
export interface RemoteTransport {
  remote: string;
  /** Sanitized HTTPS URL (no embedded credentials). */
  url: string;
  host: string;
  credential?: HostCredential;
}
