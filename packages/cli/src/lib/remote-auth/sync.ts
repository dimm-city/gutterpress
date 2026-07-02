/**
 * Snapshot-first sync + conflict resolution (#15, ADR 0006 D5).
 *
 * Every operation here is the isomorphic-git library call of the same name
 * plus minimum glue (pure isomorphic-git — CLAUDE.md §7):
 *
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
  snapshotStagingMarkerPath,
  snapshotWorkingTreeUnlocked,
  withRepoLock,
} from "../source-provider.ts";
import {
  extractUrlCredential,
  type HostCredential,
  type TokenStore,
} from "./token-store.ts";
import { resolveLogger, shortOid } from "./operation-log.ts";
// The single source of truth for git error decoding lives in the recovery
// classifier — sync.ts consumes it rather than keeping parallel copies.
import {
  classifyFromHealth,
  classifyTransportFailure,
  isMergeConflictError,
  isPushRejected,
  RepoNeedsRecoveryError,
} from "./recovery/classify.ts";
import { inspectRepo } from "./recovery/inspect.ts";

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
const MSG_EXPIRED_CHOICES =
  "Those combine choices have expired. Please run Sync again.";

/** Message recorded on the automatic pre-sync snapshot (D5 invariant). */
export const SYNC_SNAPSHOT_MESSAGE = "Snapshot before syncing";

/**
 * The git repo directory for a project dir. A project IS its git repo, so this
 * walks up to the enclosing repo root (opening a subfolder syncs the whole
 * repo — plain git, no per-book scoping). Anything unclassifiable is itself.
 */
async function repoDirFor(projectDir: string): Promise<string> {
  const source = await detectProjectSource(projectDir);
  if (source.type === "local-git-folder") return gitScopeFor(source);
  return projectDir;
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

/**
 * Default sync retry budget (BUG 6): 3 bounded passes with a short backoff.
 * A fast-moving remote can race the push once or twice without the user seeing
 * the false "Someone else synced at the same moment" message; a remote that
 * genuinely races EVERY pass still terminates with that friendly message and
 * the work safely snapshotted.
 */
export const DEFAULT_SYNC_RETRY: Required<Omit<SyncRetryOptions, "sleep">> = {
  attempts: 3,
  backoffMs: 150,
};

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


// ── Transport plumbing ───────────────────────────────────────────────────────

interface RemoteTransport {
  remote: string;
  /** Sanitized HTTPS URL (no embedded credentials). */
  url: string;
  host: string;
  credential?: HostCredential;
}

export function onAuthFor(credential: HostCredential | undefined) {
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

/**
 * The failure arms shared verbatim by {@link SyncOutcome}, {@link PullOutcome}
 * and {@link PushOutcome} — so one classifier serves all three operations.
 * Decoding delegates to the shared recovery classifier
 * (classifyTransportFailure): auth_required → "auth", network_unavailable →
 * "offline", anything else → the generic "error" arm.
 */
function failureOutcome(
  e: unknown,
  snapshotId?: string,
): { status: "auth" | "offline" | "error"; message: string; snapshotId?: string } {
  const kind = classifyTransportFailure(e);
  const base = snapshotId ? { snapshotId } : {};
  if (kind === "auth_required") return { status: "auth", message: MSG_AUTH, ...base };
  if (kind === "network_unavailable") return { status: "offline", message: MSG_OFFLINE, ...base };
  return {
    status: "error",
    message:
      "Syncing didn't complete. Your work is saved on this computer — please try again.",
    ...base,
  };
}

export function conflictFilesFrom(data: {
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
 * (ADR 0006 D5): commit any unsaved work in the WHOLE repo BEFORE any network
 * or merge step, so a forced post-merge checkout can never discard it. The
 * working-tree check runs lazily at action time on the caller's function-scoped
 * object cache (released with the operation).
 */
async function snapshotBeforeAction(args: {
  projectDir: string;
  dir: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  cache: GitCache;
}): Promise<string | undefined> {
  const { projectDir, dir, cache } = args;
  const hasChanges = await hasPendingChanges(dir, cache);
  const staleStaging = fs.existsSync(snapshotStagingMarkerPath(dir));
  if (!hasChanges && !staleStaging) return undefined;
  const snap = await snapshotWorkingTreeUnlocked({
    projectDir,
    repoRoot: dir,
    message: args.message?.trim() || SYNC_SNAPSHOT_MESSAGE,
    authorName: args.authorName,
    authorEmail: args.authorEmail,
  });
  return snap.id;
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

// ── syncProject ────────────────────────────────────────────────────────────

/** Real-timer sleep used as the default backoff between sync passes. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Snapshot-first sync (ADR 0006 D5) — the composition of {@link pullChanges}
 * then {@link pushChanges}. If someone pushes between our pull and our push,
 * the push reports pull-first and the pair re-runs (their commits merge in on
 * the next pass), with a short backoff between passes. The loop is ALWAYS
 * bounded by `retry.attempts` (BUG 6 — a fast-moving remote no longer triggers
 * a FALSE race message after only two attempts); a remote that genuinely races
 * every pass surfaces a friendly "try again" rather than looping forever. The
 * snapshot-first guarantee holds on every path (the work is saved locally
 * before any network step). Never throws for expected outcomes — everything is
 * reported through the {@link SyncOutcome} union.
 */
export async function syncProject(
  options: SyncProjectOptions,
): Promise<SyncOutcome> {
  const logger = resolveLogger(options.logFile, "sync");

  // ── Structural preflight — never touch the tree of a damaged repo ─────────
  // An interrupted merge/rebase/cherry-pick, detached HEAD, stale lock, or
  // missing .git must be repaired BEFORE any sync work: the snapshot step
  // below would otherwise commit whatever is on disk (e.g. the literal
  // conflict markers a half-done native-git merge leaves in tracked files)
  // and push it. Throwing a typed error here routes every host through the
  // same catch → inspectRepo → classifyGitError → recover() path it already
  // uses for mid-sync failures. checkLocalChanges:false — only the structural
  // flags matter here, and pull performs the working-tree walk anyway.
  const health = await inspectRepo({ repoDir: options.projectDir }, { checkLocalChanges: false });
  const structural = classifyFromHealth(health);
  if (structural) {
    logger.warn("sync", "structural preflight blocked sync", { kind: structural });
    throw new RepoNeedsRecoveryError(structural);
  }
  // Bounded, defaulted retry policy. attempts ≥ 1, backoffMs ≥ 0 (clamped so a
  // caller can never request an unbounded or negative-delay loop).
  const attempts = Math.max(1, options.retry?.attempts ?? DEFAULT_SYNC_RETRY.attempts);
  const backoffMs = Math.max(0, options.retry?.backoffMs ?? DEFAULT_SYNC_RETRY.backoffMs);
  const sleep = options.retry?.sleep ?? defaultSleep;

  let snapshotId: string | undefined;
  let pulled = false;
  let filesChanged = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    logger.info("sync", `sync pass ${attempt + 1}/${attempts}`);
    const pull = await pullChanges(options);
    snapshotId = snapshotId ?? pull.snapshotId;
    const base = snapshotId ? { snapshotId } : {};
    if (pull.status === "conflict") {
      logger.warn("sync", `pull conflict`, { files: pull.files.map((f) => f.path) });
      return { ...pull, ...base };
    }
    if (pull.status !== "pulled" && pull.status !== "up-to-date") {
      logger.warn("sync", `pull non-success`, { status: pull.status });
      return { ...pull, ...base }; // auth / offline / error
    }
    pulled = pulled || pull.status === "pulled";
    filesChanged = filesChanged || (pull.status === "pulled" && pull.filesChanged);

    const push = await pushChanges(options);
    snapshotId = snapshotId ?? push.snapshotId;
    switch (push.status) {
      case "pushed":
        logger.info("sync", `synced`, { pulled });
        return {
          status: "synced",
          message: pulled ? MSG_SYNCED_MERGED : MSG_SYNCED,
          mergedRemoteChanges: pulled,
          ...(filesChanged ? { filesChanged: true } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
      case "up-to-date":
        logger.info("sync", `up-to-date`, { pulled });
        return {
          status: "up-to-date",
          message: pulled ? MSG_UP_TO_DATE_PULLED : MSG_UP_TO_DATE,
          ...(filesChanged ? { filesChanged: true } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
      case "pull-first":
        logger.info("sync", `push rejected (non-fast-forward) — retrying`);
        // Someone pushed mid-sync — re-run the pair. Back off briefly before
        // the next pass (skip the sleep after the final attempt, since the
        // loop is about to exit). Their commits merge in on the next pull.
        if (attempt < attempts - 1 && backoffMs > 0) await sleep(backoffMs);
        continue;
      default:
        logger.warn("sync", `push non-success`, { status: push.status });
        return {
          ...push,
          ...(filesChanged ? { filesChanged: true } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
    }
  }
  logger.error("sync", `exhausted ${attempts} retry attempts (race)`);
  return {
    status: "error",
    message: MSG_RACE,
    ...(filesChanged ? { filesChanged: true } : {}),
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
  // A project is its git repo: pull operates on the enclosing repo root
  // (opening a subfolder syncs the whole repo — that is what Git does).
  const dir = await repoDirFor(options.projectDir);

  return withRepoLock(dir, async (): Promise<PullOutcome> => {
    // One object cache for this pull only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot FIRST (D5) — the merge below ends in a forced checkout, so
      // committing the whole working tree first guarantees nothing is lost.
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        message: options.message,
        authorName: options.authorName,
        authorEmail: options.authorEmail,
        cache,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      const logger = resolveLogger(options.logFile, "sync");
      logger.info("pull", `branch=${branch} local=${short(localTip)} fetched=${short(remoteTip)}`);

      if (!remoteTip || remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }

      // Let git.merge decide: it fast-forwards when local is behind, makes a
      // combine commit when both sides moved, no-ops (`alreadyMerged`) when we
      // are already ahead, and throws MergeConflictError on a true conflict.
      // `abortOnConflict` (default true) guarantees a conflicted merge leaves
      // the working tree and index COMPLETELY untouched.
      try {
        await git.merge({
          fs,
          dir,
          cache,
          ours: branch,
          theirs: remoteTip,
          author: gitAuthor(options.authorName, options.authorEmail),
          message: "Combined your changes with the online version",
        });
      } catch (e) {
        if (isMergeConflictError(e)) {
          const conflictPaths = conflictFilesFrom(e.data).map((f) => f.path);
          logger.warn("pull", `merge conflict`, {
            files: conflictPaths,
            local: short(localTip),
            remote: short(remoteTip),
          });
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
        // The merge was a no-op (`alreadyMerged`): we were already ahead of
        // the online tip, so there was nothing to bring down.
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
  const dir = await repoDirFor(options.projectDir);

  return withRepoLock(dir, async (): Promise<PushOutcome> => {
    // One object cache for this push only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot-if-needed (D5) so unsaved work is part of what gets sent.
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        message: options.message,
        authorName: options.authorName,
        authorEmail: options.authorEmail,
        cache,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      const logger = resolveLogger(options.logFile, "sync");
      logger.info("push", `branch=${branch} local=${short(localTip)} fetched=${short(remoteTip)} snapshot=${snapshotId ? short(snapshotId) : "none"}`);

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

/**
 * True when `oid` resolves to a real COMMIT object in this repo. Used to reject
 * well-formed-but-nonexistent ids (BUG 5) before any merge work — a stale id
 * from an expired conflict dialog must surface a friendly "run Sync again"
 * message, not an unhandled isomorphic-git throw. Reads the commit on the
 * caller's function-scoped cache (released with the operation).
 */
async function isRealCommit(
  dir: string,
  oid: string,
  cache: GitCache,
): Promise<boolean> {
  try {
    await git.readCommit({ fs, dir, cache, oid });
    return true;
  } catch {
    return false;
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
  const logger = resolveLogger(options.logFile, "sync");
  logger.info("resolve", "starting conflict resolution", {
    files: options.resolutions.map((r) => `${r.path}:${r.choice}`),
    local: shortOid(options.localId),
    remote: shortOid(options.remoteId),
    allowUnrelated: options.allowUnrelatedHistories ?? false,
  });
  // Same repo-scope rules as syncProject: conflict resolution for a book
  // subfolder runs against the enclosing repository (conflict paths are
  // repo-root-relative), with the entry snapshot scoped to the book.
  const dir = await repoDirFor(options.projectDir);

  // Normalize both ids once at entry — every oid comparison below is lowercase.
  const normalizedLocalId = options.localId.toLowerCase();
  const normalizedRemoteId = options.remoteId.toLowerCase();
  if (
    !/^[0-9a-f]{40}$/.test(normalizedRemoteId) ||
    !/^[0-9a-f]{40}$/.test(normalizedLocalId)
  ) {
    return {
      status: "error",
      message: MSG_EXPIRED_CHOICES,
    };
  }

  return withRepoLock(dir, async (): Promise<SyncOutcome> => {
    // One object cache for this resolve operation only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);
      const author = gitAuthor(options.authorName, options.authorEmail);

      // Verify both ids are REAL commit objects in this repo before doing any
      // work (BUG 5). A well-formed-but-garbage hex id passes the regex above
      // but would later make isomorphic-git throw deep in the merge, producing
      // a generic "error" with no guidance. Read each commit up front; if
      // either is missing/expired, return the SAME friendly expired-choices
      // message as the regex-fail path — and nothing has been changed.
      const bothExist =
        (await isRealCommit(dir, normalizedLocalId, cache)) &&
        (await isRealCommit(dir, normalizedRemoteId, cache));
      if (!bothExist) {
        return { status: "error", message: MSG_EXPIRED_CHOICES };
      }

      // Safety: capture any edits (whole tree) made while the choices dialog
      // was open, before the merge's forced checkout can touch them.
      if (await hasPendingChanges(dir)) {
        const snap = await snapshotWorkingTreeUnlocked({
          projectDir: options.projectDir,
          repoRoot: dir,
          message: SYNC_SNAPSHOT_MESSAGE,
          authorName: options.authorName,
          authorEmail: options.authorEmail,
        });
        snapshotId = snap.id;
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
      // WHY postBinaryFixes: the merge driver receives file contents as UTF-8
      // decoded strings. For binary files (images, PDFs, audio — any file with
      // bytes >= 0x80 that are not valid UTF-8) this round-trip corrupts the
      // chosen side's bytes (non-UTF-8 sequences become U+FFFD replacement
      // chars). The merge driver is still called so the merge commit is honest
      // (two-parent, correct tree oid for text files), but after the forced
      // checkout we overwrite every decided binary file with the exact raw bytes
      // read directly from the git object store (Uint8Array, never decoded).
      // This has NO effect on text files (correct bytes in, correct bytes out).
      const postBinaryFixes: Array<{ path: string; content: Uint8Array }> = [];

      for (const resolution of options.resolutions) {
        const filepath = resolution.path;
        const mine = await tryReadBlob(dir, localTip, filepath, cache);
        const theirs = await tryReadBlob(dir, remoteId, filepath, cache);

        if (mine && theirs) {
          // Edited in both copies → settled inside the merge by the driver.
          if (resolution.choice === "theirs") {
            driverChoice.set(filepath, "theirs");
            // Write the chosen raw bytes after checkout to guard against
            // UTF-8 round-trip corruption in the merge driver for binary files.
            postBinaryFixes.push({ path: filepath, content: theirs });
          } else {
            driverChoice.set(filepath, "mine");
            // Write the chosen raw bytes after checkout (binary safety — see
            // postBinaryFixes comment above).
            postBinaryFixes.push({ path: filepath, content: mine });
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
            authorEmail: options.authorEmail,
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
          allowUnrelatedHistories: options.allowUnrelatedHistories ?? false,
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

      // Binary safety: overwrite decided files with raw Uint8Array bytes from
      // the chosen side's git object (see postBinaryFixes comment above). For
      // text files this is a no-op (same bytes). For binary files this
      // corrects the UTF-8 corruption that the string-based merge driver
      // introduces. We write directly without creating a new commit here —
      // the bytes match the blob the merge commit already records (same oid),
      // so the working tree stays consistent with HEAD.
      for (const fix of postBinaryFixes) {
        const abs = path.join(dir, fix.path);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, fix.content);
      }

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
        logger.error("resolve", `setup error`, { error: e.message });
        return { status: "error", message: e.message, ...(snapshotId ? { snapshotId } : {}) };
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("resolve", `unexpected error`, { error: errMsg });
      return failureOutcome(e, snapshotId);
    }
  });
}
