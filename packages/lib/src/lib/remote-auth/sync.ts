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
import { getRepoCache } from "../git-cache.ts";
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
   * Working-tree edits the pre-sync snapshot would commit. Paths are
   * repo-root-relative; for book-subfolder projects the list is scoped to
   * the book's folder (what Sync's own snapshot is scoped to). `sample` is
   * capped at {@link PREVIEW_FILE_LIMIT}; `count` is the full total.
   */
  changedFiles: { count: number; sample: string[] };
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

function failureOutcome(e: unknown, snapshotId?: string): SyncOutcome {
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
): Promise<string | null> {
  try {
    const result = await git.fetch({
      fs,
      http,
      dir,
      cache: getRepoCache(dir),
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
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // 1. Snapshot FIRST — the author's work is now unconditionally safe,
      //    before any network call or merge can run (the D5 invariant).
      //    Scoped to the book's folder for subfolder projects.
      if (await hasPendingChanges(dir, subPath || undefined)) {
        const snap = await snapshotWorkingTreeUnlocked({
          projectDir: options.projectDir,
          repoRoot: dir,
          ...(subPath ? { subPath } : {}),
          message: options.message?.trim() || SYNC_SNAPSHOT_MESSAGE,
          authorName: options.authorName,
        });
        snapshotId = snap.id;
      }
      // 1b. Shared-folder safety: a subfolder project may share the repo with
      //     sibling books that have their own pending edits. The merge below
      //     ends in a FORCED checkout, which would discard those edits — so
      //     they are committed first, honestly labeled. (Repo-root projects
      //     never hit this: their step-1 snapshot already cleaned the tree.)
      if (subPath && (await hasPendingChanges(dir))) {
        await snapshotWorkingTreeUnlocked({
          projectDir: dir,
          message: SHARED_FOLDER_SNAPSHOT_MESSAGE,
          authorName: options.authorName,
        });
      }

      // 2–3. fetch → fast-forward/merge → push. If someone syncs between
      // our fetch and our push, the push is rejected — re-run the loop ONCE
      // (their commits merge in on the second pass), then surface a friendly
      // "try again" rather than looping forever.
      for (let attempt = 0; attempt < 2; attempt++) {
        const remoteTip = await fetchRemoteTip(dir, branch, transport, http);
        const localTip = await git.resolveRef({ fs, dir, ref: branch });

        let merged = false;
        if (remoteTip && remoteTip !== localTip) {
          const remoteIsBehind = await git.isDescendent({
            fs,
            dir,
            cache: getRepoCache(dir),
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
                cache: getRepoCache(dir),
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
            await git.checkout({ fs, dir, cache: getRepoCache(dir), ref: branch, force: true });
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
            cache: getRepoCache(dir),
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
      if (
        e instanceof Error &&
        (e.message === MSG_NO_REMOTE ||
          e.message === MSG_SSH_REMOTE ||
          e.message === MSG_NO_BRANCH)
      ) {
        return {
          status: "error",
          message: e.message,
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
): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => {
    if (fs.existsSync(path.join(dir, candidate))) return true;
    for (const oid of oids) {
      if ((await tryReadBlob(dir, oid, candidate)) !== null) return true;
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
): Promise<Uint8Array | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, cache: getRepoCache(dir), oid, filepath });
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
        const mine = await tryReadBlob(dir, localTip, filepath);
        const theirs = await tryReadBlob(dir, remoteId, filepath);

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
                path: await uniqueOnlineCopyPath(dir, filepath, [localTip, remoteId]),
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
          cache: getRepoCache(dir),
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
      await git.checkout({ fs, dir, cache: getRepoCache(dir), ref: branch, force: true });

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
          cache: getRepoCache(dir),
          remote: transport.remote,
          ref: branch,
          ...onAuthFor(transport.credential),
        });
      try {
        await doPush();
      } catch (e) {
        if (!isPushRejected(e)) throw e;
        const newRemoteTip = await fetchRemoteTip(dir, branch, transport, http);
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
            cache: getRepoCache(dir),
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
        await git.checkout({ fs, dir, cache: getRepoCache(dir), ref: branch, force: true });
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
): Promise<{ count: number; capped: boolean }> {
  const walk = await commitsSince(dir, tip, stopAt);
  return { count: walk.commits.length, capped: walk.capped };
}

/**
 * Same walk as {@link countCommitsSince}, but keeps the commit details
 * (summary line / author / date) for the sync-preview lists.
 */
async function commitsSince(
  dir: string,
  tip: string,
  stopAt: string | undefined,
): Promise<{ commits: SyncCommitInfo[]; capped: boolean }> {
  const log = await git.log({ fs, dir, cache: getRepoCache(dir), ref: tip, depth: AHEAD_BEHIND_CAP + 1 });
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
    const branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    const pending = await hasPendingChanges(dir, subPath || undefined);
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
        remoteTip = await fetchRemoteTip(dir, branch, transport, http);
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
      const ahead = await countCommitsSince(dir, branch, undefined);
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
        cache: getRepoCache(dir),
        oids: [localTip, remoteTip],
      })) as string[];
      mergeBase = bases[0];
    } catch {
      mergeBase = undefined;
    }
    const ahead = await countCommitsSince(dir, localTip, mergeBase);
    const behind = await countCommitsSince(dir, remoteTip, mergeBase);
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
/** Changed working-tree paths sampled in a sync preview. */
export const PREVIEW_FILE_LIMIT = 10;

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

/**
 * What would a Sync do right now? FETCHES the tracked remote branch (never
 * merges, never pushes, never snapshots) and reports both directions with
 * commit details, plus the working-tree edits the pre-sync snapshot would
 * commit. Backs the Sync dialog's open/refresh view.
 *
 * Failure model: a failed fetch (offline / rejected connection) NEVER throws —
 * the preview degrades to local information (the last-fetched record of the
 * online tip) with a friendly `fetchNotice`. Serialized on the per-repo lock.
 */
export async function previewSync(options: PreviewSyncOptions): Promise<SyncPreview> {
  const http = options.httpClient ?? httpNode;
  // Same repo-scope rules as syncProject: a book subfolder previews against
  // the ENCLOSING repository (commit counts are whole-repo — that is what a
  // sync pushes/pulls), with the changed-file list scoped to the book.
  const { dir, subPath } = await resolveRepoScope(options.projectDir);

  return withRepoLock(dir, async (): Promise<SyncPreview> => {
    const branch = (await git.currentBranch({ fs, dir })) ?? undefined;

    // Working-tree edits Sync's snapshot step would commit (book-scoped).
    // Started FIRST and awaited LATER so the (disk-bound) status walk runs
    // CONCURRENTLY with the network fetch below — on a big repo + slow
    // network these were the two serial multi-second steps of a dialog open.
    const matrixPromise = git.statusMatrix({
      fs,
      dir,
      cache: getRepoCache(dir),
      ...(subPath ? { filepaths: [subPath] } : {}),
    });
    // Park a no-op handler so a status-walk failure during the fetch can't
    // surface as an unhandled rejection; the real handling happens where
    // `changedFilesFrom()` is awaited.
    matrixPromise.catch(() => {});
    const changedFilesFrom = async () => {
      const matrix = await matrixPromise;
      const changed = matrix
        .filter(([, head, worktree, stage]) => !(head === 1 && worktree === 1 && stage === 1))
        .map(([filepath]) => filepath);
      return { count: changed.length, sample: changed.slice(0, PREVIEW_FILE_LIMIT) };
    };

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
        changedFiles: await changedFilesFrom(),
      };
    }
    if (!branch) {
      return {
        hasRemote: true,
        live: false,
        incoming: NO_COMMITS,
        outgoing: NO_COMMITS,
        changedFiles: await changedFilesFrom(),
      };
    }

    let live = false;
    let fetchNotice: string | undefined;
    let remoteTip: string | null = null;
    if (options.fetch !== false) {
      // The status walk (matrixPromise) is in flight while this fetch runs.
      try {
        remoteTip = await fetchRemoteTip(dir, branch, transport, http);
        live = true;
      } catch (e) {
        fetchNotice =
          classifyFailure(e) === "auth" ? MSG_PREVIEW_AUTH : MSG_PREVIEW_OFFLINE;
      }
    }
    const changedFiles = await changedFilesFrom();
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
      ...(fetchNotice ? { fetchNotice } : {}),
      changedFiles,
    };

    if (!localTip) {
      // Branch exists but has no commits yet (freshly initialized).
      return {
        ...baseResult,
        incoming: remoteTip
          ? toDirection(await commitsSince(dir, remoteTip, undefined))
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
        outgoing: toDirection(await commitsSince(dir, localTip, undefined)),
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
        cache: getRepoCache(dir),
        oids: [localTip, remoteTip],
      })) as string[];
      mergeBase = bases[0];
    } catch {
      mergeBase = undefined;
    }
    return {
      ...baseResult,
      incoming: toDirection(await commitsSince(dir, remoteTip, mergeBase)),
      outgoing: toDirection(await commitsSince(dir, localTip, mergeBase)),
    };
  });
}
