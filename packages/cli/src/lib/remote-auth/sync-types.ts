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

/**
 * One file that changed on both sides and cannot carry conflict markers (a
 * binary, or an SVG whose XML markers would break). Both versions are on
 * disk and committed: ours stayed at `path`, the online one was written
 * beside it. The host names the pair so the writer can fix it by hand.
 */
export interface KeptBothFile {
  /** Repo-relative path holding OUR version (unchanged). */
  path: string;
  /** Repo-relative path holding the ONLINE version (`name.online.ext`). */
  onlinePath: string;
}

/** Outcome of a sync attempt. Sync always converges — there is no "conflict"
 *  arm: overlapping text edits land in the file inside standard git conflict
 *  markers (`combinedFiles`), clashing binaries keep BOTH versions as two
 *  files (`keptBothFiles`), and every version is always reachable in
 *  history. Owner ruling 2026-08-14. */
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
      /** Files whose text now holds BOTH versions inside git conflict markers. */
      combinedFiles?: string[];
      /** Files kept as a pair (ours at `path`, theirs at `onlinePath`). */
      keptBothFiles?: KeptBothFile[];
    }
  | { status: "up-to-date"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "auth"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "offline"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "error"; message: string; snapshotId?: string; filesChanged?: boolean };

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
   * Bounded retry policy for {@link syncProject}'s fetch→merge→push race
   * loop. The loop is ALWAYS bounded (never infinite) and the snapshot-first
   * guarantee holds on every path. Defaults to {@link DEFAULT_SYNC_RETRY}. `sleep` is
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

// ResolveConflictsOptions / ConflictFile / ConflictKind / ConflictResolution
// were removed with the interactive conflict flow (owner ruling 2026-08-14):
// sync always converges, so there is nothing for a host to resolve.

/** Resolved project remote + credential used by every transport call. */
export interface RemoteTransport {
  remote: string;
  /** Sanitized HTTPS URL (no embedded credentials). */
  url: string;
  host: string;
  credential?: HostCredential;
}
