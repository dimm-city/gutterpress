/**
 * Snapshot-first sync + conflict resolution (#15, ADR 0006 D5).
 *
 * Sync sequence (ONE per-repo lock span, pure isomorphic-git — CLAUDE.md §7):
 *
 *   1. Snapshot any working-tree changes FIRST — the author's work is now
 *      unconditionally safe, before any network or merge step can touch it.
 *   2. Fetch the tracked remote branch.
 *   3. Remote unchanged → push. Remote moved → fast-forward or clean merge,
 *      then push. Push rejected because someone synced mid-flight → the
 *      whole fetch/merge/push loop re-runs once.
 *   4. True conflict → abort cleanly (the working tree is NEVER left with
 *      conflict markers — `abortOnConflict` keeps the tree at the pre-merge
 *      snapshot) and return `{ status: "conflict", files }` so the UI can ask
 *      per-file: Keep my version · Use the online version · Keep both copies.
 *
 * `resolveConflicts` applies those choices WITHOUT ever materializing conflict
 * markers: a custom isomorphic-git `mergeDriver` returns the chosen side's
 * content for each decided file (and replicates the default diff3 auto-merge
 * for undecided files), producing an HONEST two-parent merge commit — both
 * histories stay intact and visible. Delete-involved conflicts (a file deleted
 * on one side, edited on the other) can't reach the merge driver, so they are
 * settled by small explicit commits around the merge (see resolveConflicts).
 *
 * Failure model (ADR 0006 D5/D7): offline → friendly retry-later (the snapshot
 * already saved the work locally); 401/403 → `{ status: "auth" }` for the
 * single "Reconnect" action; anything else → a friendly, jargon-free message.
 * Token values never appear in messages (transport errors are mapped, and the
 * remote URL used is pre-sanitized via `extractUrlCredential`).
 */
import * as fs from "node:fs";
import { unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";
// WHY diff3: this is the SAME tiny (~100-line, zero-dependency) module
// isomorphic-git's own default merge driver uses, so our "replicate the
// default auto-merge for undecided files" path behaves identically. It is
// unmaintained but stable and pinned to an EXACT version in package.json.
// If it ever breaks, inline the diff3 algorithm here (rule §5 inline-copy
// precedent) rather than swapping in a heavier diff library.
import diff3Merge from "diff3";

import { detectProjectSource } from "../project-source.ts";
import {
  gitAuthor,
  gitScopeFor,
  hasPendingChanges,
  snapshotWorkingTreeUnlocked,
  withRepoLock,
} from "../source-provider.ts";
import {
  extractUrlCredential,
  type HostCredential,
  type TokenStore,
} from "./token-store.ts";

/**
 * isomorphic-git object cache, scoped to ONE operation (one function call)
 * and released with it. NEVER share these across operations or hold them in
 * module state: reading any object from a packfile makes isomorphic-git load
 * the ENTIRE pack into the cache (measured ~1.3–3.8 GB RSS on a 2 GB repo),
 * so a long-lived shared cache pins that memory for the life of the process —
 * the root cause of the 0.5.0 "sync uses 2 GB" report.
 */
type GitCache = Record<string, unknown>;

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
    }
  | { status: "up-to-date"; message: string; snapshotId?: string }
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
  | { status: "auth"; message: string; snapshotId?: string }
  | { status: "offline"; message: string; snapshotId?: string }
  | { status: "error"; message: string; snapshotId?: string };

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
      /** How many online commits were applied (capped walk; ≥ 1). */
      incomingApplied: number;
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

// ── Author-language copy (never raw git words) ───────────────────────────────

const MSG_UP_TO_DATE = "Everything is in sync.";
const MSG_UP_TO_DATE_PULLED =
  "Everything is in sync. The latest online changes were downloaded to this computer.";
const MSG_SYNCED = "Your changes are online.";
const MSG_SYNCED_MERGED =
  "Your changes are online, combined with changes from the online copy.";
const MSG_OFFLINE =
  "Your changes are saved on this computer. print-md couldn't reach the online repository — try syncing again when you're back online.";
const MSG_AUTH =
  "The online repository didn't accept the saved connection. Reconnect and try again.";
const MSG_RACE =
  "Someone else synced changes at the same moment. Your work is saved on this computer — please try Sync again.";
const MSG_CONFLICT =
  "Your copy and the online copy both changed. Choose which version to keep for each file — a safety snapshot of your work was taken first.";
const MSG_NO_REMOTE =
  "This project isn't connected to an online repository yet.";
const MSG_SSH_REMOTE =
  "This project's online address uses SSH (git@…), which print-md can't sync to. Switch it to the web (HTTPS) address to sync from here.";
const MSG_NO_BRANCH =
  "This project's version history isn't on a named branch, so it can't be synced right now.";
const MSG_PULLED =
  "The latest online changes were downloaded to this computer.";
const MSG_PULLED_MERGED =
  "The latest online changes were combined with your changes on this computer.";
const MSG_PULL_UP_TO_DATE = "You already have the latest online changes.";
const MSG_PUSH_UP_TO_DATE = "There's nothing new to send — everything is already online.";
const MSG_PULL_FIRST =
  "The online copy has changes you don't have yet. Get the latest changes first, then send yours.";

/** Message recorded on the automatic pre-sync snapshot (D5 invariant). */
export const SYNC_SNAPSHOT_MESSAGE = "Snapshot before syncing";

/**
 * Message recorded when a book that shares its repository with sibling
 * folders has pending changes OUTSIDE its own folder at sync time. Those
 * changes must be committed too before any merge/checkout step (the forced
 * post-merge checkout would otherwise discard them — the D5 "never lose
 * work" invariant applies to the whole shared folder).
 */
export const SHARED_FOLDER_SNAPSHOT_MESSAGE =
  "Snapshot of other changes in this shared folder before syncing";

/**
 * Resolve the repository root + book subfolder scope for a project dir.
 * A repo-root project (or anything unclassifiable) scopes to itself.
 */
async function resolveRepoScope(
  projectDir: string,
): Promise<{ dir: string; subPath: string }> {
  const source = await detectProjectSource(projectDir);
  if (source.type === "local-git-folder") return gitScopeFor(source);
  return { dir: projectDir, subPath: "" };
}

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
  /** Injectable git HTTP transport for tests. */
  httpClient?: typeof httpNode;
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
  httpClient?: typeof httpNode;
}

export interface SyncStatusOptions {
  projectDir: string;
  /** Also fetch the online tip so the counts are live (network). */
  fetch?: boolean;
  credential?: HostCredential;
  tokenStore?: TokenStore;
  httpClient?: typeof httpNode;
}

export interface PreviewSyncOptions {
  projectDir: string;
  /** Explicit credential; wins over the token store. */
  credential?: HostCredential;
  /** Host-keyed store used to resolve the credential for the remote's host. */
  tokenStore?: TokenStore;
  /** Injectable git HTTP transport for tests. */
  httpClient?: typeof httpNode;
  /**
   * `false` skips the live network fetch entirely and previews against the
   * last-fetched record of the online tip (`live: false`, no `fetchNotice`).
   * Backs the Sync dialog's instant first paint; the live preview follows.
   * Default `true`.
   */
  fetch?: boolean;
}

/** One commit in a sync-preview direction list ("ER Update — 9 hours ago"). */
export interface SyncCommitInfo {
  id: string;
  /** First line of the commit message. */
  message: string;
  author: string;
  /** Unix milliseconds (matches SnapshotEntry.timestamp). */
  timestamp: number;
}

/** One direction (incoming or outgoing) of a sync preview. */
export interface SyncDirectionInfo {
  /**
   * Commit count for this direction. `null` when unknown — the live check
   * failed AND there is no local record of the online tip to compare against.
   */
  count: number | null;
  /** Newest-first commit details, capped at {@link PREVIEW_COMMIT_LIMIT}. */
  commits: SyncCommitInfo[];
  /** True when `count` is a lower bound (walk cap or shallow boundary). */
  approximate: boolean;
}

/**
 * What a Sync would do, in both directions — backs the Sync dialog's
 * "Incoming changes from the online copy (4)" / "Your changes to send (1)"
 * view. Produced by {@link previewSync}, which FETCHES (never merges).
 */
export interface SyncPreview {
  hasRemote: boolean;
  branch?: string;
  /** True when `incoming` reflects a successful live fetch just now. */
  live: boolean;
  /**
   * Friendly notice when the live check failed (offline / rejected
   * connection). The rest of the preview degrades to local information.
   * Never contains URLs or credentials.
   */
  fetchNotice?: string;
  /** Online commits not on this computer yet (sync would merge them in). */
  incoming: SyncDirectionInfo;
  /** Local commits not online yet (sync would push them). */
  outgoing: SyncDirectionInfo;
  /**
   * ALWAYS `{ count: 0, sample: [] }` since the 0.5.0 fetch-first rebuild —
   * the preview never scans the working tree (see `workingTree`). The field
   * is kept (rather than removed) so existing consumers keep type-checking;
   * treat it as "no information", not "no edits".
   */
  changedFiles: { count: number; sample: string[] };
  /**
   * Honesty marker for `changedFiles`: `"skipped"` means the working tree
   * was NOT scanned, so `changedFiles` carries no information. On a large
   * repository a status walk loads entire packfiles (multi-GB RSS), so the
   * preview never runs one. Unsaved edits are still safe: `syncProject`
   * snapshots them at action time, and the host's auto-snapshot usually has
   * already committed them into `outgoing`. Hosts wanting a live
   * unsaved-edits indicator should use their own file watcher.
   */
  workingTree: "skipped";
}

/** Ahead/behind summary for the "N changes to sync" UI. */
export interface SyncStatusResult {
  hasRemote: boolean;
  branch?: string;
  /** Snapshots not yet online. `null` when there is nothing to compare against. */
  ahead: number | null;
  /** Online snapshots not yet on this computer. `null` when unknown. */
  behind: number | null;
  /** Working-tree edits that would be snapshotted by Sync. */
  hasUnsnapshottedChanges: boolean;
  /** True when the counts include a live check of the online repository. */
  live: boolean;
  /**
   * True when `ahead`/`behind` are lower bounds rather than exact: the walk
   * hit the {@link AHEAD_BEHIND_CAP} or a shallow-clone boundary. The UI
   * should render such counts as "250+".
   */
  approximate: boolean;
}

// ── Transport plumbing ───────────────────────────────────────────────────────

interface RemoteTransport {
  remote: string;
  /** Sanitized HTTPS URL (no embedded credentials). */
  url: string;
  host: string;
  credential?: HostCredential;
}

function onAuthFor(credential: HostCredential | undefined) {
  if (!credential) return {};
  return {
    onAuth: () => ({
      // Same convention as clone.ts: GitHub accepts any username with the
      // token as password (covers OAuth gho_ and legacy ghu_ tokens); plain
      // tokens use the stored username (or the token-as-username convention
      // every smart-HTTPS forge accepts).
      username:
        credential.kind === "github-oauth"
          ? "x-access-token"
          : credential.username || credential.token,
      password: credential.token,
    }),
  };
}

/**
 * Resolve the project's tracked remote + credential. Throws friendly errors
 * for the no-remote / SSH cases (the UI should have gated on diagnose, but
 * the lib must stay safe to call directly).
 */
async function resolveTransport(
  dir: string,
  options: { credential?: HostCredential; tokenStore?: TokenStore },
): Promise<RemoteTransport> {
  const remotes = await git.listRemotes({ fs, dir });
  const origin = remotes.find((r) => r.remote === "origin") ?? remotes[0];
  if (!origin?.url) throw new Error(MSG_NO_REMOTE);

  const { cleanUrl, credential: urlCredential } = extractUrlCredential(origin.url);
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    throw new Error(MSG_SSH_REMOTE);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(MSG_SSH_REMOTE);
  const host = parsed.port
    ? `${parsed.hostname}:${parsed.port}`.toLowerCase()
    : parsed.hostname.toLowerCase();

  let credential = options.credential ?? undefined;
  if (!credential && options.tokenStore) {
    try {
      credential = (await options.tokenStore.get(host)) ?? undefined;
    } catch {
      credential = undefined;
    }
  }
  if (!credential && urlCredential) credential = urlCredential;

  return {
    remote: origin.remote,
    url: cleanUrl,
    host,
    ...(credential ? { credential } : {}),
  };
}

/** Classify a transport/merge failure into the D5/D7 outcome buckets. */
function classifyFailure(e: unknown): "auth" | "offline" | null {
  const err = e as { code?: string; data?: { statusCode?: number }; message?: string };
  if (err?.code === "HttpError") {
    const status = err.data?.statusCode;
    if (status === 401 || status === 403) return "auth";
  }
  const msg = err?.message ?? String(e);
  if (/\b401\b|\b403\b|unauthorized|authentication|not authorized/i.test(msg)) {
    return "auth";
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|fetch failed|couldn't reach|socket hang ?up/i.test(
      msg,
    )
  ) {
    return "offline";
  }
  return null;
}

/**
 * The failure arms shared verbatim by {@link SyncOutcome}, {@link PullOutcome}
 * and {@link PushOutcome} — so one classifier serves all three operations.
 */
function failureOutcome(
  e: unknown,
  snapshotId?: string,
): { status: "auth" | "offline" | "error"; message: string; snapshotId?: string } {
  const kind = classifyFailure(e);
  const base = snapshotId ? { snapshotId } : {};
  if (kind === "auth") return { status: "auth", message: MSG_AUTH, ...base };
  if (kind === "offline") return { status: "offline", message: MSG_OFFLINE, ...base };
  return {
    status: "error",
    message:
      "Syncing didn't complete. Your work is saved on this computer — please try again.",
    ...base,
  };
}

function isMergeConflictError(
  e: unknown,
): e is { data: { filepaths: string[]; bothModified: string[]; deleteByUs: string[]; deleteByTheirs: string[] } } {
  return (e as { code?: string })?.code === "MergeConflictError";
}

function isPushRejected(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  // Client-side check: isomorphic-git compares against the server's fresh ref
  // advertisement before uploading and throws PushRejectedError itself.
  if (code === "PushRejectedError") return true;
  // Server-side check: if the ref moves BETWEEN the advertisement and the
  // server applying the update, the rejection arrives as a report-status
  // "ng <ref> non-fast-forward" line, surfaced as GitPushError.
  if (code === "GitPushError") {
    return /non-fast-forward/i.test((e as Error)?.message ?? "");
  }
  return false;
}

function conflictFilesFrom(data: {
  filepaths: string[];
  bothModified: string[];
  deleteByUs: string[];
  deleteByTheirs: string[];
}): ConflictFile[] {
  const byUs = new Set(data.deleteByUs ?? []);
  const byThem = new Set(data.deleteByTheirs ?? []);
  return (data.filepaths ?? []).map((p) => ({
    path: p,
    kind: byUs.has(p) ? "you-deleted" : byThem.has(p) ? "online-deleted" : "both-edited",
  }));
}

/** Friendly setup-problem message for the expected gate errors, else null. */
function setupErrorMessage(e: unknown): string | null {
  if (
    e instanceof Error &&
    (e.message === MSG_NO_REMOTE ||
      e.message === MSG_SSH_REMOTE ||
      e.message === MSG_NO_BRANCH)
  ) {
    return e.message;
  }
  return null;
}

/**
 * Snapshot-first step shared by syncProject / pullChanges / pushChanges
 * (ADR 0006 D5): commit any unsaved work BEFORE any network or merge step.
 * The working-tree check runs lazily at action time and uses the caller's
 * function-scoped object cache (released with the operation — this is the
 * ONLY statusMatrix on these interactive paths).
 *
 * `includeSharedFolder` commits sibling-folder edits too — REQUIRED before
 * any operation that ends in a forced checkout (merge/fast-forward), which
 * would otherwise discard them. Push never touches the working tree, so it
 * passes false.
 */
async function snapshotBeforeAction(args: {
  projectDir: string;
  dir: string;
  subPath: string;
  message?: string;
  authorName?: string;
  cache: GitCache;
  includeSharedFolder: boolean;
}): Promise<string | undefined> {
  const { projectDir, dir, subPath, cache } = args;
  let snapshotId: string | undefined;
  if (await hasPendingChanges(dir, subPath || undefined, cache)) {
    const snap = await snapshotWorkingTreeUnlocked({
      projectDir,
      repoRoot: dir,
      ...(subPath ? { subPath } : {}),
      message: args.message?.trim() || SYNC_SNAPSHOT_MESSAGE,
      authorName: args.authorName,
    });
    snapshotId = snap.id;
  }
  if (args.includeSharedFolder && subPath && (await hasPendingChanges(dir, undefined, cache))) {
    await snapshotWorkingTreeUnlocked({
      projectDir: dir,
      message: SHARED_FOLDER_SNAPSHOT_MESSAGE,
      authorName: args.authorName,
    });
  }
  return snapshotId;
}

async function currentBranchOrThrow(dir: string): Promise<string> {
  const branch = await git.currentBranch({ fs, dir });
  if (!branch) throw new Error(MSG_NO_BRANCH);
  return branch;
}

/**
 * Fetch the tracked branch's online tip. Returns `null` when the online
 * repository has no such branch yet (a freshly created empty repo).
 */
async function fetchRemoteTip(
  dir: string,
  branch: string,
  transport: RemoteTransport,
  http: typeof httpNode,
  cache: GitCache,
): Promise<string | null> {
  try {
    const result = await git.fetch({
      fs,
      http,
      dir,
      cache,
      remote: transport.remote,
      ref: branch,
      singleBranch: true,
      tags: false,
      ...onAuthFor(transport.credential),
    });
    return result.fetchHead ?? null;
  } catch (e) {
    // A brand-new empty repository has no refs to fetch — that's "remote has
    // nothing", not a failure.
    const code = (e as { code?: string })?.code;
    if (code === "NotFoundError" || code === "NoRefspecError") return null;
    throw e;
  }
}

// ── syncProject ────────────────────────────────────────────────────────────

/**
 * Snapshot-first sync (ADR 0006 D5). Never throws for expected outcomes —
 * everything is reported through the {@link SyncOutcome} union so hosts can
 * map statuses to author-friendly screens. Serialized on the per-repo lock.
 */
export async function syncProject(
  options: SyncProjectOptions,
): Promise<SyncOutcome> {
  const http = options.httpClient ?? httpNode;
  // Book subfolders of a larger repo sync against the ENCLOSING repository:
  // the snapshot is scoped to the book's folder, but fetch/merge/push operate
  // on the whole repo (that is what Git does). The lock keys on the repo root
  // so two books in one repository serialize.
  const { dir, subPath } = await resolveRepoScope(options.projectDir);

  return withRepoLock(dir, async (): Promise<SyncOutcome> => {
    // One object cache for this sync operation only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // 1 + 1b. Snapshot FIRST — the author's work is now unconditionally
      //    safe before any network call or merge can run (the D5 invariant).
      //    Book-scoped, plus the shared-folder safety commit (the merge below
      //    ends in a FORCED checkout, which would discard sibling-book edits).
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        subPath,
        message: options.message,
        authorName: options.authorName,
        cache,
        includeSharedFolder: true,
      });

      // 2–3. fetch → fast-forward/merge → push. If someone syncs between
      // our fetch and our push, the push is rejected — re-run the loop ONCE
      // (their commits merge in on the second pass), then surface a friendly
      // "try again" rather than looping forever.
      for (let attempt = 0; attempt < 2; attempt++) {
        const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
        const localTip = await git.resolveRef({ fs, dir, ref: branch });

        let merged = false;
        if (remoteTip && remoteTip !== localTip) {
          const remoteIsBehind = await git.isDescendent({
            fs,
            dir,
            cache,
            oid: localTip,
            ancestor: remoteTip,
            depth: -1,
          });
          if (!remoteIsBehind) {
            // Remote moved: fast-forward when possible, else a clean merge.
            // `abortOnConflict` (default true) guarantees a conflicted merge
            // leaves the working tree and index COMPLETELY untouched.
            try {
              await git.merge({
                fs,
                dir,
                cache,
                ours: branch,
                theirs: remoteTip,
                author: gitAuthor(options.authorName),
                message: "Combined your changes with the online version",
              });
            } catch (e) {
              if (isMergeConflictError(e)) {
                return {
                  status: "conflict",
                  message: MSG_CONFLICT,
                  files: conflictFilesFrom(e.data),
                  localId: localTip,
                  remoteId: remoteTip,
                  ...(snapshotId ? { snapshotId } : {}),
                };
              }
              throw e;
            }
            // merge() moves the branch ref but does not update the working
            // tree — sync it. The tree is clean (snapshotted above), so the
            // forced checkout can't discard anything.
            await git.checkout({ fs, dir, cache, ref: branch, force: true });
            merged = true;
          }
        }

        const tipAfterMerge = await git.resolveRef({ fs, dir, ref: branch });
        if (remoteTip && tipAfterMerge === remoteTip) {
          // Fast-forwarded onto the online tip (or already identical):
          // nothing of ours to upload.
          return {
            status: "up-to-date",
            message: merged ? MSG_UP_TO_DATE_PULLED : MSG_UP_TO_DATE,
            ...(snapshotId ? { snapshotId } : {}),
          };
        }

        try {
          await git.push({
            fs,
            http,
            dir,
            cache,
            remote: transport.remote,
            ref: branch,
            ...onAuthFor(transport.credential),
          });
        } catch (e) {
          if (isPushRejected(e) && attempt === 0) continue; // re-run loop once
          if (isPushRejected(e)) {
            return {
              status: "error",
              message: MSG_RACE,
              ...(snapshotId ? { snapshotId } : {}),
            };
          }
          throw e;
        }
        return {
          status: "synced",
          message: merged ? MSG_SYNCED_MERGED : MSG_SYNCED,
          mergedRemoteChanges: merged,
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      // Unreachable (the loop returns or throws), but keeps TS satisfied.
      return { status: "error", message: MSG_RACE, ...(snapshotId ? { snapshotId } : {}) };
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) {
        return {
          status: "error",
          message: setupMsg,
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      return failureOutcome(e, snapshotId);
    }
  });
}

// ── pullChanges ──────────────────────────────────────────────────────────────

/**
 * Pull-only operation (the History tab's "Pull"): snapshot-if-needed →
 * fetch → fast-forward or clean merge of the online changes — NEVER a push.
 *
 * Same conflict semantics as {@link syncProject}: `abortOnConflict` keeps the
 * working tree completely untouched and the conflict comes back as
 * `{ status: "conflict", files }` for the per-file choices dialog. Serialized
 * on the per-repo lock; one function-scoped object cache, released on return.
 */
export async function pullChanges(
  options: SyncProjectOptions,
): Promise<PullOutcome> {
  const http = options.httpClient ?? httpNode;
  // Same repo-scope rules as syncProject: a book subfolder pulls into the
  // ENCLOSING repository (that is what Git does); the snapshot is book-scoped.
  const { dir, subPath } = await resolveRepoScope(options.projectDir);

  return withRepoLock(dir, async (): Promise<PullOutcome> => {
    // One object cache for this pull only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot FIRST (D5) — the merge below ends in a forced checkout, so
      // the shared-folder safety commit applies exactly as in syncProject.
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        subPath,
        message: options.message,
        authorName: options.authorName,
        cache,
        includeSharedFolder: true,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      if (!remoteTip || remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }
      const remoteIsBehind = await git.isDescendent({
        fs,
        dir,
        cache,
        oid: localTip,
        ancestor: remoteTip,
        depth: -1,
      });
      if (remoteIsBehind) {
        // Everything online is already here (we're strictly ahead).
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }

      // Count the incoming commits BEFORE merging (refs/commit-objects only).
      let mergeBase: string | undefined;
      try {
        const bases = (await git.findMergeBase({
          fs,
          dir,
          cache,
          oids: [localTip, remoteTip],
        })) as string[];
        mergeBase = bases[0];
      } catch {
        mergeBase = undefined;
      }
      const incoming = await countCommitsSince(dir, remoteTip, mergeBase, cache);

      // Fast-forward when possible, else a clean merge. `abortOnConflict`
      // (default true) guarantees a conflicted merge leaves the working tree
      // and index COMPLETELY untouched.
      try {
        await git.merge({
          fs,
          dir,
          cache,
          ours: branch,
          theirs: remoteTip,
          author: gitAuthor(options.authorName),
          message: "Combined your changes with the online version",
        });
      } catch (e) {
        if (isMergeConflictError(e)) {
          return {
            status: "conflict",
            message: MSG_CONFLICT,
            files: conflictFilesFrom(e.data),
            localId: localTip,
            remoteId: remoteTip,
            ...base,
          };
        }
        throw e;
      }
      // merge() moves the branch ref but does not update the working tree —
      // sync it. The tree is clean (snapshotted above), so the forced
      // checkout can't discard anything.
      await git.checkout({ fs, dir, cache, ref: branch, force: true });

      const newTip = await git.resolveRef({ fs, dir, ref: branch });
      // A fast-forward lands exactly on the online tip; anything else means a
      // combine (merge) commit was created.
      const merged = newTip !== remoteTip;
      // "Did the content change?" — compare the commits' tree ids (cheap,
      // commit objects only). A merge that nets out to the same tree (e.g.
      // both sides made the identical edit) needs no preview reload.
      const treeBefore = (await git.readCommit({ fs, dir, cache, oid: localTip }))
        .commit.tree;
      const treeAfter = (await git.readCommit({ fs, dir, cache, oid: newTip }))
        .commit.tree;
      return {
        status: "pulled",
        message: merged ? MSG_PULLED_MERGED : MSG_PULLED,
        merged,
        incomingApplied: incoming.count,
        filesChanged: treeBefore !== treeAfter,
        ...base,
      };
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) {
        return {
          status: "error",
          message: setupMsg,
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      return failureOutcome(e, snapshotId);
    }
  });
}

// ── pushChanges ──────────────────────────────────────────────────────────────

/**
 * Push-only operation (the History tab's "Push"): snapshot-if-needed → push.
 * If the online copy has commits this computer doesn't have (non-fast-forward),
 * it does NOT auto-merge — the typed `"pull-first"` result tells the host to
 * show a plain-language "get the latest changes first" message. Serialized on
 * the per-repo lock; one function-scoped object cache, released on return.
 */
export async function pushChanges(
  options: SyncProjectOptions,
): Promise<PushOutcome> {
  const http = options.httpClient ?? httpNode;
  const { dir, subPath } = await resolveRepoScope(options.projectDir);

  return withRepoLock(dir, async (): Promise<PushOutcome> => {
    // One object cache for this push only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot-if-needed (D5) so unsaved work is part of what gets sent.
      // No shared-folder commit: push never touches the working tree.
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        subPath,
        message: options.message,
        authorName: options.authorName,
        cache,
        includeSharedFolder: false,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      if (remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PUSH_UP_TO_DATE, ...base };
      }
      if (remoteTip) {
        const remoteIsContained = await git.isDescendent({
          fs,
          dir,
          cache,
          oid: localTip,
          ancestor: remoteTip,
          depth: -1,
        });
        if (!remoteIsContained) {
          // The online copy is ahead (or diverged): never auto-merge here.
          return { status: "pull-first", message: MSG_PULL_FIRST, ...base };
        }
      }

      try {
        await git.push({
          fs,
          http,
          dir,
          cache,
          remote: transport.remote,
          ref: branch,
          ...onAuthFor(transport.credential),
        });
      } catch (e) {
        // The online tip moved between our fetch and the push — same answer.
        if (isPushRejected(e)) {
          return { status: "pull-first", message: MSG_PULL_FIRST, ...base };
        }
        throw e;
      }
      return { status: "pushed", message: MSG_SYNCED, ...base };
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) {
        return {
          status: "error",
          message: setupMsg,
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      return failureOutcome(e, snapshotId);
    }
  });
}

// ── resolveConflicts ──────────────────────────────────────────────────────────

/**
 * `chapter-01.md` → `chapter-01 (online copy).md` (next to the original).
 * `counter` ≥ 2 produces `chapter-01 (online copy 2).md`, … — used to avoid
 * clobbering a pre-existing file with the same name.
 */
export function onlineCopyPath(filepath: string, counter?: number): string {
  const dirname = path.posix.dirname(filepath);
  const ext = path.posix.extname(filepath);
  const stem = path.posix.basename(filepath, ext);
  const label = counter && counter >= 2 ? `online copy ${counter}` : "online copy";
  const renamed = `${stem} (${label})${ext}`;
  return dirname === "." ? renamed : `${dirname}/${renamed}`;
}

/**
 * First "(online copy)" name that doesn't already exist in the working dir or
 * in either side's tree — a pre-existing file with that name must never be
 * overwritten by a "Keep both copies" resolution.
 */
async function uniqueOnlineCopyPath(
  dir: string,
  filepath: string,
  oids: string[],
  cache: GitCache,
): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => {
    if (fs.existsSync(path.join(dir, candidate))) return true;
    for (const oid of oids) {
      if ((await tryReadBlob(dir, oid, candidate, cache)) !== null) return true;
    }
    return false;
  };
  let candidate = onlineCopyPath(filepath);
  for (let n = 2; await taken(candidate); n++) {
    candidate = onlineCopyPath(filepath, n);
  }
  return candidate;
}

async function tryReadBlob(
  dir: string,
  oid: string,
  filepath: string,
  cache: GitCache,
): Promise<Uint8Array | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, cache, oid, filepath });
    return blob;
  } catch {
    return null;
  }
}

/** Replicates isomorphic-git's default diff3 merge for UNDECIDED files. */
const LINEBREAKS = /^.*(\r?\n|$)/gm;
function defaultDiff3(
  baseContent: string,
  ourContent: string,
  theirContent: string,
): { cleanMerge: boolean; mergedText: string } {
  const result = diff3Merge(
    ourContent.match(LINEBREAKS) ?? [],
    baseContent.match(LINEBREAKS) ?? [],
    theirContent.match(LINEBREAKS) ?? [],
  );
  let mergedText = "";
  let cleanMerge = true;
  for (const item of result) {
    if (item.ok) mergedText += item.ok.join("");
    if (item.conflict) {
      // NEVER emit conflict markers: flag it unclean (the merge aborts and the
      // working tree stays exactly as it was) and keep our content as the
      // placeholder text — the written object is unreferenced and never
      // checked out.
      cleanMerge = false;
      mergedText += item.conflict.a.join("");
    }
  }
  return { cleanMerge, mergedText };
}

/**
 * Apply the author's per-file choices and sync the combined result
 * (ADR 0006 D5). The merge commit has TWO PARENTS — the local branch tip and
 * the online tip — so both histories remain intact and View History stays
 * honest about what was combined.
 *
 * How each choice is applied WITHOUT conflict markers:
 *
 * - Files edited in both copies are settled inside the merge itself by a
 *   custom `mergeDriver` that returns the chosen side's content ("Keep both
 *   copies" keeps mine and writes the online version to
 *   `<name> (online copy)<ext>` beforehand, committed on the local side so it
 *   is part of the merge). Undecided files auto-merge with the same diff3
 *   algorithm a plain merge uses.
 * - Delete-involved conflicts never reach a merge driver, so they are settled
 *   by equalizing the local side BEFORE the merge (making both sides agree so
 *   the merge is clean) and, when the author chose the now-removed side, a
 *   small follow-up commit AFTER the merge restores their choice. The merge
 *   commit still carries both parents; the around-commits are visible,
 *   honestly labeled steps in View History.
 */
export async function resolveConflicts(
  options: ResolveConflictsOptions,
): Promise<SyncOutcome> {
  const http = options.httpClient ?? httpNode;
  // Same repo-scope rules as syncProject: conflict resolution for a book
  // subfolder runs against the enclosing repository (conflict paths are
  // repo-root-relative), with the entry snapshot scoped to the book.
  const { dir, subPath } = await resolveRepoScope(options.projectDir);

  // Normalize both ids once at entry — every oid comparison below is lowercase.
  const normalizedLocalId = options.localId.toLowerCase();
  const normalizedRemoteId = options.remoteId.toLowerCase();
  if (
    !/^[0-9a-f]{40}$/.test(normalizedRemoteId) ||
    !/^[0-9a-f]{40}$/.test(normalizedLocalId)
  ) {
    return {
      status: "error",
      message: "Those combine choices have expired. Please run Sync again.",
    };
  }

  return withRepoLock(dir, async (): Promise<SyncOutcome> => {
    // One object cache for this resolve operation only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);
      const author = gitAuthor(options.authorName);

      // Safety: capture any edits made while the choices dialog was open
      // (scoped to the book for subfolder projects).
      if (await hasPendingChanges(dir, subPath || undefined)) {
        const snap = await snapshotWorkingTreeUnlocked({
          projectDir: options.projectDir,
          repoRoot: dir,
          ...(subPath ? { subPath } : {}),
          message: SYNC_SNAPSHOT_MESSAGE,
          authorName: options.authorName,
        });
        snapshotId = snap.id;
      }
      // Shared-folder safety (see syncProject step 1b): sibling-book edits
      // must be committed before the merge's forced checkout can run.
      if (subPath && (await hasPendingChanges(dir))) {
        await snapshotWorkingTreeUnlocked({
          projectDir: dir,
          message: SHARED_FOLDER_SNAPSHOT_MESSAGE,
          authorName: options.authorName,
        });
      }

      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const remoteId = normalizedRemoteId;

      // Build the per-file plan. "mine" is read from the CURRENT local tip
      // (not the stale localId) so edits made after the conflict was reported
      // count as the author's version.
      const driverChoice = new Map<string, "mine" | "theirs">();
      const preWrites: Array<{ path: string; content: Uint8Array }> = [];
      const preDeletes: string[] = [];
      const postWrites: Array<{ path: string; content: Uint8Array }> = [];
      const postDeletes: string[] = [];

      for (const resolution of options.resolutions) {
        const filepath = resolution.path;
        const mine = await tryReadBlob(dir, localTip, filepath, cache);
        const theirs = await tryReadBlob(dir, remoteId, filepath, cache);

        if (mine && theirs) {
          // Edited in both copies → settled inside the merge by the driver.
          if (resolution.choice === "theirs") {
            driverChoice.set(filepath, "theirs");
          } else {
            driverChoice.set(filepath, "mine");
            if (resolution.choice === "both") {
              // Uniquified: a pre-existing "(online copy)" file (from an
              // earlier "Keep both") must survive untouched.
              preWrites.push({
                path: await uniqueOnlineCopyPath(dir, filepath, [localTip, remoteId], cache),
                content: theirs,
              });
            }
          }
        } else if (!mine && theirs) {
          // The author deleted it; the online copy edited it. Equalize to the
          // online content so the merge is clean; if they chose "mine"
          // (stay deleted), remove it again right after the merge.
          preWrites.push({ path: filepath, content: theirs });
          if (resolution.choice === "mine") postDeletes.push(filepath);
        } else if (mine && !theirs) {
          // The online copy deleted it; the author edited it. Equalize to the
          // deletion so the merge is clean; unless they chose the online
          // version (accept the deletion), restore their file after the merge.
          preDeletes.push(filepath);
          if (resolution.choice !== "theirs") {
            postWrites.push({ path: filepath, content: mine });
          }
        }
        // (!mine && !theirs): nothing exists on either side — nothing to do.
      }

      const applyChanges = async (
        writes: Array<{ path: string; content: Uint8Array }>,
        deletes: string[],
        message: string,
      ): Promise<void> => {
        for (const w of writes) {
          const abs = path.join(dir, w.path);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, w.content);
        }
        for (const d of deletes) {
          await unlink(path.join(dir, d)).catch(() => {});
        }
        if (await hasPendingChanges(dir)) {
          await snapshotWorkingTreeUnlocked({
            projectDir: dir,
            message,
            authorName: options.authorName,
          });
        }
      };

      // Pre-merge step: "(online copy)" files + delete-conflict equalization,
      // committed on the local side so the merge sees them.
      await applyChanges(
        preWrites,
        preDeletes,
        "Saved your choices for combining with the online version",
      );

      // The honest two-parent merge. The driver decides per-file; undecided
      // files auto-merge exactly like a normal merge (diff3). If anything is
      // STILL conflicted (an undecided file), the merge aborts untouched and
      // the remaining files go back to the author.
      try {
        await git.merge({
          fs,
          dir,
          cache,
          ours: branch,
          theirs: remoteId,
          author,
          message: "Combined your changes with the online version",
          mergeDriver: ({ contents, path: filepath }) => {
            const base = contents[0] ?? "";
            const mine = contents[1] ?? "";
            const theirs = contents[2] ?? "";
            const choice = driverChoice.get(filepath);
            if (choice === "mine") return { cleanMerge: true, mergedText: mine };
            if (choice === "theirs") return { cleanMerge: true, mergedText: theirs };
            return defaultDiff3(base, mine, theirs);
          },
        });
      } catch (e) {
        if (isMergeConflictError(e)) {
          return {
            status: "conflict",
            message: MSG_CONFLICT,
            files: conflictFilesFrom(e.data),
            localId: await git.resolveRef({ fs, dir, ref: branch }),
            remoteId,
            ...(snapshotId ? { snapshotId } : {}),
          };
        }
        throw e;
      }
      // merge() moves the ref only — sync the working tree to the result.
      await git.checkout({ fs, dir, cache, ref: branch, force: true });

      // Post-merge step: restore the author's chosen side for delete-involved
      // files that had to be equalized the other way for the merge.
      await applyChanges(postWrites, postDeletes, "Applied your chosen versions");

      // Push, with ONE recovery pass: if someone synced between the
      // author's choices and this push, re-fetch the new online tip and
      // either merge it in cleanly and push again (no author interaction
      // needed) or hand back a FRESH conflict carrying the NEW tip — the UI
      // re-renders the choices screen from a conflict outcome, so the author
      // never sees a dead-end "try again" for a resolvable race.
      const doPush = () =>
        git.push({
          fs,
          http,
          dir,
          cache,
          remote: transport.remote,
          ref: branch,
          ...onAuthFor(transport.credential),
        });
      try {
        await doPush();
      } catch (e) {
        if (!isPushRejected(e)) throw e;
        const newRemoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
        if (!newRemoteTip) {
          return {
            status: "error",
            message: MSG_RACE,
            ...(snapshotId ? { snapshotId } : {}),
          };
        }
        try {
          await git.merge({
            fs,
            dir,
            cache,
            ours: branch,
            theirs: newRemoteTip,
            author,
            message: "Combined your changes with the online version",
          });
        } catch (mergeErr) {
          if (isMergeConflictError(mergeErr)) {
            // Still conflicted against the NEW online tip: a fresh conflict
            // outcome (new remoteId) so the next confirm targets reality.
            return {
              status: "conflict",
              message: MSG_CONFLICT,
              files: conflictFilesFrom(mergeErr.data),
              localId: await git.resolveRef({ fs, dir, ref: branch }),
              remoteId: newRemoteTip,
              ...(snapshotId ? { snapshotId } : {}),
            };
          }
          throw mergeErr;
        }
        await git.checkout({ fs, dir, cache, ref: branch, force: true });
        try {
          await doPush();
        } catch (retryErr) {
          if (isPushRejected(retryErr)) {
            return {
              status: "error",
              message: MSG_RACE,
              ...(snapshotId ? { snapshotId } : {}),
            };
          }
          throw retryErr;
        }
      }

      return {
        status: "synced",
        message: MSG_SYNCED_MERGED,
        mergedRemoteChanges: true,
        ...(snapshotId ? { snapshotId } : {}),
      };
    } catch (e) {
      if (
        e instanceof Error &&
        (e.message === MSG_NO_REMOTE ||
          e.message === MSG_SSH_REMOTE ||
          e.message === MSG_NO_BRANCH)
      ) {
        return { status: "error", message: e.message, ...(snapshotId ? { snapshotId } : {}) };
      }
      return failureOutcome(e, snapshotId);
    }
  });
}

// ── getSyncStatus ──────────────────────────────────────────────────────────

/**
 * Cap on the ahead/behind history walk. Counts past this are useless to the
 * UI ("250+ changes") and an unbounded `git.log` walk over a long history is
 * the most expensive thing this status call could do.
 */
const AHEAD_BEHIND_CAP = 250;

/**
 * Commits reachable from `tip` but not from `stopAt` (exclusive), capped at
 * {@link AHEAD_BEHIND_CAP}. `capped` is true when the count is a lower bound:
 * the walk hit the cap, or — on a shallow clone — ended at the shallow
 * boundary (no root commit seen) without finding `stopAt`.
 */
async function countCommitsSince(
  dir: string,
  tip: string,
  stopAt: string | undefined,
  cache: GitCache,
): Promise<{ count: number; capped: boolean }> {
  const walk = await commitsSince(dir, tip, stopAt, cache);
  return { count: walk.commits.length, capped: walk.capped };
}

/**
 * Same walk as {@link countCommitsSince}, but keeps the commit details
 * (summary line / author / date) for the sync-preview lists. Reads COMMIT
 * objects only — never trees or blobs — so it stays fast and small even on
 * repositories with multi-GB packfiles.
 */
async function commitsSince(
  dir: string,
  tip: string,
  stopAt: string | undefined,
  cache: GitCache,
): Promise<{ commits: SyncCommitInfo[]; capped: boolean }> {
  const log = await git.log({ fs, dir, cache, ref: tip, depth: AHEAD_BEHIND_CAP + 1 });
  const commits: SyncCommitInfo[] = [];
  for (const c of log) {
    if (stopAt && c.oid === stopAt) return { commits, capped: false };
    commits.push({
      id: c.oid,
      message: (c.commit.message ?? "").split("\n", 1)[0]?.trim() ?? "",
      author: c.commit.author?.name ?? "",
      timestamp: (c.commit.author?.timestamp ?? 0) * 1000,
    });
  }
  if (commits.length > AHEAD_BEHIND_CAP) {
    return { commits: commits.slice(0, AHEAD_BEHIND_CAP), capped: true };
  }
  // Walk exhausted without finding `stopAt`: exact only when it reached a
  // root commit; isomorphic-git stops silently at shallow-clone boundaries,
  // which would otherwise masquerade as a complete walk.
  const sawRoot = log.some((c) => c.commit.parent.length === 0);
  return { commits, capped: !sawRoot };
}

/**
 * Ahead/behind counts vs the tracked remote branch, so the UI can show
 * "2 changes to sync". Local compare by default (no network); pass
 * `fetch: true` (with a credential when the remote needs one) for live counts.
 * A failed live fetch degrades to the local compare (`live: false`).
 */
export async function getSyncStatus(
  options: SyncStatusOptions,
): Promise<SyncStatusResult> {
  const http = options.httpClient ?? httpNode;
  // Subfolder projects read the ENCLOSING repo's branch/remote; the
  // unsnapshotted-changes flag is scoped to the book's own folder (what a
  // Sync would actually snapshot). Ahead/behind compare whole-repo tips —
  // that is what a sync pushes/pulls.
  const { dir, subPath } = await resolveRepoScope(options.projectDir);

  return withRepoLock(dir, async (): Promise<SyncStatusResult> => {
    // One object cache for this status call only — released with it.
    const cache: GitCache = {};
    const branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    const pending = await hasPendingChanges(dir, subPath || undefined, cache);
    const base: Omit<SyncStatusResult, "ahead" | "behind" | "live" | "approximate"> = {
      hasRemote: false,
      ...(branch ? { branch } : {}),
      hasUnsnapshottedChanges: pending,
    };

    let transport: RemoteTransport;
    try {
      transport = await resolveTransport(dir, options);
    } catch {
      return { ...base, ahead: null, behind: null, live: false, approximate: false };
    }
    if (!branch) {
      return {
        ...base,
        hasRemote: true,
        ahead: null,
        behind: null,
        live: false,
        approximate: false,
      };
    }

    let live = false;
    let remoteTip: string | null = null;
    if (options.fetch) {
      try {
        remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
        live = true;
      } catch {
        live = false; // degrade to the local compare below
      }
    }
    if (!remoteTip) {
      try {
        remoteTip = await git.resolveRef({
          fs,
          dir,
          ref: `refs/remotes/${transport.remote}/${branch}`,
        });
      } catch {
        remoteTip = null;
      }
    }
    if (!remoteTip) {
      // No record of the online tip yet: nothing local has been synced yet.
      const ahead = await countCommitsSince(dir, branch, undefined, cache);
      return {
        ...base,
        hasRemote: true,
        ahead: ahead.count,
        behind: live ? 0 : null,
        live,
        approximate: ahead.capped,
      };
    }

    const localTip = await git.resolveRef({ fs, dir, ref: branch });
    if (localTip === remoteTip) {
      return { ...base, hasRemote: true, ahead: 0, behind: 0, live, approximate: false };
    }
    let mergeBase: string | undefined;
    try {
      const bases = (await git.findMergeBase({
        fs,
        dir,
        cache,
        oids: [localTip, remoteTip],
      })) as string[];
      mergeBase = bases[0];
    } catch {
      mergeBase = undefined;
    }
    const ahead = await countCommitsSince(dir, localTip, mergeBase, cache);
    const behind = await countCommitsSince(dir, remoteTip, mergeBase, cache);
    return {
      ...base,
      hasRemote: true,
      ahead: ahead.count,
      behind: behind.count,
      live,
      approximate: ahead.capped || behind.capped,
    };
  });
}

// ── previewSync ──────────────────────────────────────────────────────────────

/** Commit details listed per direction in a sync preview. */
export const PREVIEW_COMMIT_LIMIT = 20;

const MSG_PREVIEW_OFFLINE =
  "Couldn't reach the online repository to check for new changes.";
const MSG_PREVIEW_AUTH =
  "The online repository didn't accept the saved connection, so new online changes couldn't be checked.";

function toDirection(walk: {
  commits: SyncCommitInfo[];
  capped: boolean;
}): SyncDirectionInfo {
  return {
    count: walk.commits.length,
    commits: walk.commits.slice(0, PREVIEW_COMMIT_LIMIT),
    approximate: walk.capped,
  };
}

const NO_COMMITS: SyncDirectionInfo = { count: 0, commits: [], approximate: false };
const UNKNOWN_COMMITS: SyncDirectionInfo = {
  count: null,
  commits: [],
  approximate: false,
};
/** The preview never scans the working tree — see {@link SyncPreview.workingTree}. */
const EMPTY_CHANGED_FILES: SyncPreview["changedFiles"] = { count: 0, sample: [] };

/**
 * What would a Sync do right now? Fetch-first and refs-only:
 *
 *   1. FETCH the tracked remote branch (single branch, no tags). Never
 *      merges, never pushes, never snapshots. `fetch: false` skips this and
 *      previews against the last-fetched record of the online tip.
 *   2. Compute incoming/outgoing purely from REFS: resolve the local and
 *      remote-tracking tips and walk COMMIT OBJECTS to the merge base
 *      (capped). No tree or blob is ever read, and no working tree is
 *      scanned — see {@link SyncPreview.workingTree}.
 *
 * Design note (0.5.0 rebuild): the preview used to run a `statusMatrix` so
 * `changedFiles` could list unsaved edits. On a large repository that walk
 * loads entire packfiles (measured ~3.8 GB peak / 2+ s on a 2 GB repo), which
 * made opening the Sync dialog unusable. The scan is GONE: `changedFiles` is
 * always empty with `workingTree: "skipped"`. Unsaved edits remain safe —
 * `syncProject` still snapshots them at action time, and the host's
 * auto-snapshot (10-min debounce + project-close flush) has usually already
 * committed them, so they show up honestly in `outgoing`. Hosts that want a
 * live unsaved-edits indicator should use their own file watcher.
 *
 * Failure model: a failed fetch (offline / rejected connection) NEVER throws —
 * the preview degrades to local information (the last-fetched record of the
 * online tip) with a friendly `fetchNotice`.
 *
 * Locking: a live preview WRITES `.git` state (the fetch updates the
 * remote-tracking ref and may add packs), so it serializes on the per-repo
 * lock. A `fetch: false` preview is a pure ref/commit read and runs
 * LOCK-FREE — it cannot corrupt anything and must not queue behind a running
 * auto-snapshot (same rationale as `listHistoryPage`).
 */
export async function previewSync(options: PreviewSyncOptions): Promise<SyncPreview> {
  const http = options.httpClient ?? httpNode;
  // Same repo-scope rules as syncProject: a book subfolder previews against
  // the ENCLOSING repository (commit counts are whole-repo — that is what a
  // sync pushes/pulls).
  const { dir } = await resolveRepoScope(options.projectDir);

  if (options.fetch === false) {
    return previewFromRefs(dir, options, { live: false, remoteTip: null });
  }
  return withRepoLock(dir, async (): Promise<SyncPreview> => {
    // One object cache for this preview only — released with it.
    const cache: GitCache = {};
    const branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    let transport: RemoteTransport;
    try {
      transport = await resolveTransport(dir, options);
    } catch {
      return previewFromRefs(dir, options, { live: false, remoteTip: null }, cache);
    }
    if (!branch) {
      return {
        hasRemote: true,
        live: false,
        incoming: NO_COMMITS,
        outgoing: NO_COMMITS,
        changedFiles: EMPTY_CHANGED_FILES,
        workingTree: "skipped",
      };
    }
    let live = false;
    let fetchNotice: string | undefined;
    let remoteTip: string | null = null;
    try {
      remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      live = true;
    } catch (e) {
      fetchNotice =
        classifyFailure(e) === "auth" ? MSG_PREVIEW_AUTH : MSG_PREVIEW_OFFLINE;
    }
    return previewFromRefs(
      dir,
      options,
      { live, remoteTip, ...(fetchNotice ? { fetchNotice } : {}) },
      cache,
    );
  });
}

/**
 * Refs-only preview core: local tip vs (just-fetched or last-fetched)
 * remote-tracking tip, commit walks to the merge base. Pure read — safe to
 * run without the repo lock.
 */
async function previewFromRefs(
  dir: string,
  options: PreviewSyncOptions,
  fetched: { live: boolean; remoteTip: string | null; fetchNotice?: string },
  cache: GitCache = {},
): Promise<SyncPreview> {
  const branch = (await git.currentBranch({ fs, dir })) ?? undefined;

  let transport: RemoteTransport;
  try {
    transport = await resolveTransport(dir, options);
  } catch {
    return {
      hasRemote: false,
      ...(branch ? { branch } : {}),
      live: false,
      incoming: NO_COMMITS,
      outgoing: NO_COMMITS,
      changedFiles: EMPTY_CHANGED_FILES,
      workingTree: "skipped",
    };
  }
  if (!branch) {
    return {
      hasRemote: true,
      live: fetched.live,
      ...(fetched.fetchNotice ? { fetchNotice: fetched.fetchNotice } : {}),
      incoming: NO_COMMITS,
      outgoing: NO_COMMITS,
      changedFiles: EMPTY_CHANGED_FILES,
      workingTree: "skipped",
    };
  }

  const { live } = fetched;
  let remoteTip = fetched.remoteTip;
  if (!live) {
    // Degrade to the last-fetched record of the online tip, if any.
    try {
      remoteTip = await git.resolveRef({
        fs,
        dir,
        ref: `refs/remotes/${transport.remote}/${branch}`,
      });
    } catch {
      remoteTip = null;
    }
  }

  const localTip = await git
    .resolveRef({ fs, dir, ref: branch })
    .catch(() => null);
  const baseResult = {
    hasRemote: true,
    branch,
    live,
    ...(fetched.fetchNotice ? { fetchNotice: fetched.fetchNotice } : {}),
    changedFiles: EMPTY_CHANGED_FILES,
    workingTree: "skipped" as const,
  };

  if (!localTip) {
    // Branch exists but has no commits yet (freshly initialized).
    return {
      ...baseResult,
      incoming: remoteTip
        ? toDirection(await commitsSince(dir, remoteTip, undefined, cache))
        : live
          ? NO_COMMITS
          : UNKNOWN_COMMITS,
      outgoing: NO_COMMITS,
    };
  }
  if (!remoteTip) {
    // Live fetch found no online branch (empty repo) → nothing incoming.
    // Fetch failed AND no local record → incoming is honestly unknown.
    return {
      ...baseResult,
      incoming: live ? NO_COMMITS : UNKNOWN_COMMITS,
      outgoing: toDirection(await commitsSince(dir, localTip, undefined, cache)),
    };
  }
  if (remoteTip === localTip) {
    return { ...baseResult, incoming: NO_COMMITS, outgoing: NO_COMMITS };
  }

  let mergeBase: string | undefined;
  try {
    const bases = (await git.findMergeBase({
      fs,
      dir,
      cache,
      oids: [localTip, remoteTip],
    })) as string[];
    mergeBase = bases[0];
  } catch {
    mergeBase = undefined;
  }
  return {
    ...baseResult,
    incoming: toDirection(await commitsSince(dir, remoteTip, mergeBase, cache)),
    outgoing: toDirection(await commitsSince(dir, localTip, mergeBase, cache)),
  };
}
