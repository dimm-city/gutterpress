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
 * One image file that changed on both sides. Sync already converged (the
 * NEWER side's bytes are on disk and committed — the safe default); this
 * record lets a host offer a non-blocking side-by-side picker afterwards.
 * Both blob oids are pinned by the merge commit's two parents, so the picker
 * can never go stale.
 */
export interface ImageClash {
  /** Repo-relative path of the image. */
  path: string;
  /** Blob oid of the local version. */
  localOid: string;
  /** Blob oid of the online version. */
  remoteOid: string;
  /** Which side the automatic newer-wins policy kept on disk. */
  kept: "local" | "online";
}

/** Outcome of a sync attempt. Sync always converges — there is no "conflict"
 *  arm: overlapping text edits land in the file inside standard git conflict
 *  markers (`combinedFiles`), clashing binaries keep the newer side
 *  (`imageClashes` for images), and the other version is always reachable in
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
      /** Clashing images (newer kept) for the host's non-blocking picker. */
      imageClashes?: ImageClash[];
    }
  | { status: "up-to-date"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "auth"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "offline"; message: string; snapshotId?: string; filesChanged?: boolean }
  | {
      status: "error";
      message: string;
      /**
       * Stable machine-readable signal so a host UI can route without
       * string-matching `message` (which stays free to reword):
       * "needs-connection-setup" — the project isn't set up right (no
       * remote / SSH remote / no named branch); route to the connect/setup
       * surface.
       */
      code?: "needs-connection-setup";
      snapshotId?: string;
      filesChanged?: boolean;
    };

/**
 * Outcome of a pull-only attempt ({@link pullChanges}): fetch + fast-forward/
 * converge-merge of the online changes, NEVER a push. The merge always lands
 * (see converge-merge.ts) — there is no "conflict" arm.
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
      /** Files whose text now holds BOTH versions inside git conflict markers. */
      combinedFiles?: string[];
      /** Clashing images (newer kept) for the host's non-blocking picker. */
      imageClashes?: ImageClash[];
    }
  | { status: "up-to-date"; message: string; snapshotId?: string }
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
