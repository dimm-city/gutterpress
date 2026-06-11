/**
 * Snapshot-first sync + conflict resolution (#15, ADR 0006 D5).
 *
 * Every operation here is the isomorphic-git library call of the same name
 * plus minimum glue (pure isomorphic-git — CLAUDE.md §7):
 *
 *   - previewSync  = `git.fetch` + `git.resolveRef` + `git.isDescendent`
 *   - pullChanges  = snapshot-if-needed → `git.fetch` + `git.merge` +
 *     `git.checkout` (fetch and merge stay separate calls — NOT `git.pull` —
 *     because `git.pull` negotiates the fetch with the LOCAL branch tip as
 *     the `have`, which on a snapshot-heavy repo makes the server send the
 *     entire repository; see `fetchRemoteTip` for the hard-won fix)
 *   - pushChanges  = snapshot-if-needed → `git.push`
 *   - syncProject  = pullChanges, then pushChanges
 *
 *   Snapshot-first invariant (ADR 0006 D5): pull/push commit any unsaved work
 *   BEFORE any network or merge step can touch it. True conflict → abort
 *   cleanly (the working tree is NEVER left with conflict markers —
 *   `abortOnConflict` keeps the tree at the pre-merge snapshot) and return
 *   `{ status: "conflict", files }` so the UI can ask per-file: Keep my
 *   version · Use the online version · Keep both copies.
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
import { mkdir, unlink, writeFile } from "node:fs/promises";
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
   * Whether this direction has changes: tip equality plus the library's
   * depth-capped `git.isDescendent` decide the direction. `true` = changes
   * exist (or diverged/unknown — a false "changes" is a harmless no-op
   * pull/push, while a false "nothing" hides the author's chapters), `false`
   * = none, `null` = honestly unknown (nothing to compare against).
   */
  hasChanges: boolean | null;
  /** Always `null` when `hasChanges` is true — the check never counts. */
  count: number | null;
  /** Always `[]` — the check never reads commit details. (IPC-shape compat.) */
  commits: SyncCommitInfo[];
  /** Always `false`. (IPC-shape compat.) */
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
  /**
   * `0` when this direction provably has nothing; `null` when changes exist
   * (never counted — the status path never walks history for counts) or when
   * unknown.
   */
  ahead: number | null;
  /** Same convention as `ahead`, for the online side. */
  behind: number | null;
  /** Working-tree edits that would be snapshotted by Sync. */
  hasUnsnapshottedChanges: boolean;
  /** True when the counts include a live check of the online repository. */
  live: boolean;
  /** Always `false`. (IPC-shape compat.) */
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
    // CRITICAL: with singleBranch, isomorphic-git sends exactly ONE `have` —
    // the oid that `ref` resolves to LOCALLY. If that is the local branch tip
    // (which is usually an auto-snapshot commit the server has never seen),
    // the server finds no common base and sends the ENTIRE repository as one
    // pack (multi-GB download, buffered in memory → OOM crash on big repos).
    // So `ref` must be the REMOTE-TRACKING ref — by definition the last tip
    // the server gave us, so it always finds the common base and sends only
    // the new commits. `remoteRef` (what we ask FOR) stays the branch.
    const result = await git.fetch({
      fs,
      http,
      dir,
      cache,
      remote: transport.remote,
      ref: `refs/remotes/${transport.remote}/${branch}`,
      remoteRef: branch,
      singleBranch: true,
      tags: false,
      ...onAuthFor(transport.credential),
    });
    return result.fetchHead ?? null;
  } catch (e) {
    // A brand-new empty repository has no refs to fetch — that's "remote has
    // nothing", not a failure. ONLY NoRefspecError means that. A 404/
    // NotFoundError from GitHub means the saved connection CANNOT ACCESS the
    // repository (GitHub masks private repos as "not found" for unauthorized
    // tokens) — treating it as "empty remote" made pull report "already the
    // latest" while the user was provably behind (rc.12 field bug). Re-throw
    // as an auth-class failure so check/pull/push surface "reconnect" loudly
    // instead of lying.
    const code = (e as { code?: string })?.code;
    if (code === "NoRefspecError") return null;
    if (
      code === "NotFoundError" ||
      (e as { data?: { statusCode?: number } })?.data?.statusCode === 404
    ) {
      const err = new Error(
        "The online repository couldn't be accessed with the saved connection. Reconnect and try again.",
      ) as Error & { code: string; data: { statusCode: number } };
      err.code = "HttpError";
      err.data = { statusCode: 401 };
      throw err;
    }
    throw e;
  }
}

/** First 8 chars of an oid for diagnostic log lines (null-safe). */
function short(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 8) : "none";
}

// ── Tip comparison ───────────────────────────────────────────────────────────

/**
 * Depth cap for the {@link relateTips} `git.isDescendent` walks. Past this
 * the relation is reported as diverged-or-unknown, which the callers treat
 * as "changes in both directions" — a harmless no-op pull/push at worst.
 */
const DIRECTION_WALK_DEPTH = 200;

type TipRelation = "equal" | "remote-ahead" | "local-ahead" | "diverged-or-unknown";

/**
 * How `localTip` relates to `remoteTip`, via the LIBRARY's `git.isDescendent`
 * with a hard depth cap. The remote-ahead check runs first because it walks
 * only freshly fetched commits (the walk checks parent ids BEFORE reading
 * them, so the old local tip object itself is never read). Depth exhausted /
 * unreadable objects (shallow boundaries) → `"diverged-or-unknown"`: a false
 * "changes" is a harmless no-op pull/push, while a false "nothing" hides the
 * author's chapters (the rc.10 lesson).
 */
async function relateTips(
  dir: string,
  localTip: string,
  remoteTip: string,
  cache: GitCache,
): Promise<TipRelation> {
  if (localTip === remoteTip) return "equal";
  try {
    const remoteAhead = await git.isDescendent({
      fs,
      dir,
      cache,
      oid: remoteTip,
      ancestor: localTip,
      depth: DIRECTION_WALK_DEPTH,
    });
    if (remoteAhead) return "remote-ahead";
    const localAhead = await git.isDescendent({
      fs,
      dir,
      cache,
      oid: localTip,
      ancestor: remoteTip,
      depth: DIRECTION_WALK_DEPTH,
    });
    if (localAhead) return "local-ahead";
  } catch {
    // MaxDepthError / missing objects — fall through to the safe default.
  }
  return "diverged-or-unknown";
}

// ── syncProject ────────────────────────────────────────────────────────────

/**
 * Snapshot-first sync (ADR 0006 D5) — the composition of {@link pullChanges}
 * then {@link pushChanges}. If someone pushes between our pull and our push,
 * the push reports pull-first and the pair re-runs ONCE (their commits merge
 * in on the second pass), then surfaces a friendly "try again" rather than
 * looping forever. Never throws for expected outcomes — everything is
 * reported through the {@link SyncOutcome} union.
 */
export async function syncProject(
  options: SyncProjectOptions,
): Promise<SyncOutcome> {
  let snapshotId: string | undefined;
  let pulled = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const pull = await pullChanges(options);
    snapshotId = snapshotId ?? pull.snapshotId;
    const base = snapshotId ? { snapshotId } : {};
    if (pull.status === "conflict") return { ...pull, ...base };
    if (pull.status !== "pulled" && pull.status !== "up-to-date") {
      return { ...pull, ...base }; // auth / offline / error
    }
    pulled = pulled || pull.status === "pulled";

    const push = await pushChanges(options);
    snapshotId = snapshotId ?? push.snapshotId;
    switch (push.status) {
      case "pushed":
        return {
          status: "synced",
          message: pulled ? MSG_SYNCED_MERGED : MSG_SYNCED,
          mergedRemoteChanges: pulled,
          ...(snapshotId ? { snapshotId } : {}),
        };
      case "up-to-date":
        return {
          status: "up-to-date",
          message: pulled ? MSG_UP_TO_DATE_PULLED : MSG_UP_TO_DATE,
          ...(snapshotId ? { snapshotId } : {}),
        };
      case "pull-first":
        continue; // someone pushed mid-sync — re-run the pair once
      default:
        return { ...push, ...(snapshotId ? { snapshotId } : {}) };
    }
  }
  return {
    status: "error",
    message: MSG_RACE,
    ...(snapshotId ? { snapshotId } : {}),
  };
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

      // Field-diagnostic line (stderr → terminal + any log capture). One line
      // per pull with every input the decision uses — a user's pasted output
      // identifies the exact branch taken. No secrets: oids + remote name.
      const relation =
        !remoteTip || remoteTip === localTip
          ? null
          : await relateTips(dir, localTip, remoteTip, cache);
      console.error(
        `[sync] pull branch=${branch} remote=${transport.remote} local=${short(localTip)} fetched=${short(remoteTip)} relation=${relation ?? "n/a"}`,
      );

      if (!remoteTip || remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }
      if (relation === "local-ahead") {
        // Everything online is already here (we're strictly ahead).
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }

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
      const newTip = await git.resolveRef({ fs, dir, ref: branch });
      if (newTip === localTip) {
        // The merge was a no-op (`alreadyMerged`): local was strictly ahead
        // beyond the depth-capped relation check above.
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }
      // merge() moves the branch ref but does not update the working tree —
      // sync it. The tree is clean (snapshotted above), so the forced
      // checkout can't discard anything.
      await git.checkout({ fs, dir, cache, ref: branch, force: true });
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

      // No pre-push "is the remote ahead?" history walk here: on a large
      // repository an isDescendent walk over old history loads entire
      // packfiles (gigabytes of RSS). The push rejection below is the
      // authoritative guard — isomorphic-git refuses a non-fast-forward
      // client-side against the fresh ref advertisement, and the server
      // rejects any race after that. Both map to the same "pull-first".
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
        // The online copy is ahead (or diverged): never auto-merge here.
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
 * Ahead/behind summary vs the tracked remote branch. Local compare by default
 * (no network); pass `fetch: true` (with a credential when the remote needs
 * one) for a live check. A failed live fetch degrades to the local compare
 * (`live: false`). Directions come from {@link relateTips} — never a counting
 * walk, so `ahead`/`behind` are `0` (provably nothing) or `null` (changes
 * exist / unknown).
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
    const base = {
      hasRemote: false,
      ...(branch ? { branch } : {}),
      hasUnsnapshottedChanges: pending,
      approximate: false,
    };

    let transport: RemoteTransport;
    try {
      transport = await resolveTransport(dir, options);
    } catch {
      return { ...base, ahead: null, behind: null, live: false };
    }
    if (!branch) {
      return { ...base, hasRemote: true, ahead: null, behind: null, live: false };
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
      remoteTip = await git
        .resolveRef({ fs, dir, ref: `refs/remotes/${transport.remote}/${branch}` })
        .catch(() => null);
    }
    const localTip = await git.resolveRef({ fs, dir, ref: branch }).catch(() => null);
    if (!remoteTip) {
      // No record of the online tip: anything local is unsent; a live fetch
      // proved the remote empty.
      return {
        ...base,
        hasRemote: true,
        ahead: localTip ? null : 0,
        behind: live ? 0 : null,
        live,
      };
    }
    if (!localTip) {
      return { ...base, hasRemote: true, ahead: 0, behind: null, live };
    }

    switch (await relateTips(dir, localTip, remoteTip, cache)) {
      case "equal":
        return { ...base, hasRemote: true, ahead: 0, behind: 0, live };
      case "local-ahead":
        return { ...base, hasRemote: true, ahead: null, behind: 0, live };
      case "remote-ahead":
        return { ...base, hasRemote: true, ahead: 0, behind: null, live };
      default:
        return { ...base, hasRemote: true, ahead: null, behind: null, live };
    }
  });
}

// ── previewSync ──────────────────────────────────────────────────────────────

const MSG_PREVIEW_OFFLINE =
  "Couldn't reach the online repository to check for new changes.";
const MSG_PREVIEW_AUTH =
  "The online repository didn't accept the saved connection, so new online changes couldn't be checked.";

/** Known-empty direction. */
const NO_COMMITS: SyncDirectionInfo = {
  hasChanges: false,
  count: 0,
  commits: [],
  approximate: false,
};
/** Honestly unknown — nothing to compare against. */
const UNKNOWN_COMMITS: SyncDirectionInfo = {
  hasChanges: null,
  count: null,
  commits: [],
  approximate: false,
};
/** Changes exist (never counted — the check path reads no commit details). */
const HAS_CHANGES: SyncDirectionInfo = {
  hasChanges: true,
  count: null,
  commits: [],
  approximate: false,
};
/** The preview never scans the working tree — see {@link SyncPreview.workingTree}. */
const EMPTY_CHANGED_FILES: SyncPreview["changedFiles"] = { count: 0, sample: [] };

/**
 * What would a Sync do right now? `git.fetch` the tracked remote branch
 * (single branch, no tags — never merges, never pushes, never snapshots),
 * then `git.resolveRef` both tips and decide the direction with the
 * library's depth-capped `git.isDescendent` ({@link relateTips}):
 *
 *   tips equal → up to date · remote descends from local → incoming only ·
 *   local descends from remote → outgoing only · neither / depth exhausted →
 *   BOTH (a false "changes" is a harmless no-op pull/push; a false "nothing"
 *   hides the author's chapters — the rc.10 lesson).
 *
 * No commit lists and no counts — `SyncDirectionInfo` carries `hasChanges`
 * only (the UI renders count-less states as "New changes online" / "Changes
 * to send").
 *
 * Failure model: a failed fetch (offline / rejected connection) NEVER throws —
 * the preview degrades to the existing remote-tracking ref with a friendly
 * `fetchNotice`. `fetch: false` skips the network entirely and compares
 * against the existing tracking ref (`live: false`, no notice) — backs the
 * Sync dialog's instant first paint.
 *
 * Locking: a live preview WRITES `.git` state (the fetch updates the
 * remote-tracking ref and may add packs), so it serializes on the per-repo
 * lock. A `fetch: false` preview is a pure ref read and runs LOCK-FREE — it
 * cannot corrupt anything and must not queue behind a running auto-snapshot
 * (same rationale as `listHistoryPage`).
 */
export async function previewSync(options: PreviewSyncOptions): Promise<SyncPreview> {
  const http = options.httpClient ?? httpNode;
  // Same repo-scope rules as syncProject: a book subfolder previews against
  // the ENCLOSING repository (changes are whole-repo — that is what a sync
  // pushes/pulls).
  const { dir } = await resolveRepoScope(options.projectDir);

  if (options.fetch === false) {
    return previewFromRefs(dir, options, { live: false }, {});
  }
  return withRepoLock(dir, async (): Promise<SyncPreview> => {
    // One object cache for this preview only — released with it.
    const cache: GitCache = {};
    const branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    let transport: RemoteTransport;
    try {
      transport = await resolveTransport(dir, options);
    } catch {
      return previewFromRefs(dir, options, { live: false }, cache);
    }
    if (!branch) {
      return previewFromRefs(dir, options, { live: false }, cache);
    }
    let live = false;
    let fetchNotice: string | undefined;
    try {
      // The fetch updates refs/remotes/<remote>/<branch>; previewFromRefs
      // reads it back, so live and degraded paths share one comparison.
      await fetchRemoteTip(dir, branch, transport, http, cache);
      live = true;
    } catch (e) {
      fetchNotice =
        classifyFailure(e) === "auth" ? MSG_PREVIEW_AUTH : MSG_PREVIEW_OFFLINE;
    }
    return previewFromRefs(
      dir,
      options,
      { live, ...(fetchNotice ? { fetchNotice } : {}) },
      cache,
    );
  });
}

/**
 * Comparison core shared by the live and local (`fetch: false`) previews:
 * local branch tip vs the remote-tracking ref, direction via
 * {@link relateTips}.
 */
async function previewFromRefs(
  dir: string,
  options: PreviewSyncOptions,
  fetched: { live: boolean; fetchNotice?: string },
  cache: GitCache,
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
  const base = {
    hasRemote: true,
    ...(branch ? { branch } : {}),
    live: fetched.live,
    ...(fetched.fetchNotice ? { fetchNotice: fetched.fetchNotice } : {}),
    changedFiles: EMPTY_CHANGED_FILES,
    workingTree: "skipped" as const,
  };
  if (!branch) {
    return { ...base, incoming: NO_COMMITS, outgoing: NO_COMMITS };
  }

  const remoteTip = await git
    .resolveRef({ fs, dir, ref: `refs/remotes/${transport.remote}/${branch}` })
    .catch(() => null);
  const localTip = await git.resolveRef({ fs, dir, ref: branch }).catch(() => null);

  if (!remoteTip) {
    if (fetched.live) {
      // The live fetch found no online branch (a freshly created empty
      // repo): nothing incoming; anything local has never been sent.
      return {
        ...base,
        incoming: NO_COMMITS,
        outgoing: localTip ? HAS_CHANGES : NO_COMMITS,
      };
    }
    // No tracking ref and no live check — honestly unknown.
    return { ...base, incoming: UNKNOWN_COMMITS, outgoing: UNKNOWN_COMMITS };
  }
  if (!localTip) {
    return { ...base, incoming: HAS_CHANGES, outgoing: NO_COMMITS };
  }

  const relation = await relateTips(dir, localTip, remoteTip, cache);
  // Field-diagnostic line (stderr): one line per check with every input the
  // decision uses, so a user's pasted terminal output identifies the exact
  // branch taken. Oids + remote name only — no secrets.
  console.error(
    `[sync] check branch=${branch} remote=${transport.remote} live=${fetched.live} local=${short(localTip)} tracking=${short(remoteTip)} relation=${relation}${fetched.fetchNotice ? " notice=" + JSON.stringify(fetched.fetchNotice) : ""}`,
  );

  switch (relation) {
    case "equal":
      return { ...base, incoming: NO_COMMITS, outgoing: NO_COMMITS };
    case "remote-ahead":
      return { ...base, incoming: HAS_CHANGES, outgoing: NO_COMMITS };
    case "local-ahead":
      return { ...base, incoming: NO_COMMITS, outgoing: HAS_CHANGES };
    default:
      return { ...base, incoming: HAS_CHANGES, outgoing: HAS_CHANGES };
  }
}
