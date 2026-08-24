/**
 * Transport plumbing used by snapshot-first sync (#15, ADR 0006 D5).
 * Extracted from sync.ts: remote+credential resolution,
 * `onAuth` wiring, the snapshot-if-needed step, branch/tip helpers, the
 * remote-tip fetch (with the singleBranch `have` fix), and the shared
 * failure/conflict/setup-error mappers. Pure isomorphic-git glue — CLAUDE.md §7.
 */
import * as fs from "node:fs";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { detectProjectSource, syncRemoteFor } from "../project-source.ts";
import {
  gitScopeFor,
  hasPendingChanges,
  snapshotStagingMarkerPath,
  snapshotWorkingTreeUnlocked,
} from "../source-provider.ts";
import {
  credentialHostKey,
  extractUrlCredential,
  type HostCredential,
  type TokenStore,
} from "./token-store.ts";
// The single source of truth for git error decoding lives in the recovery
// classifier — sync.ts consumes it rather than keeping parallel copies.
import {
  classifyFromHealth,
  classifyTransportFailure,
  InsecureTransportError,
  RepoNeedsRecoveryError,
} from "./recovery/classify.ts";
import { inspectRepo } from "./recovery/inspect.ts";
import type { OperationLogger } from "./operation-log.ts";
import {
  MSG_AUTH,
  MSG_INSECURE_TRANSPORT,
  MSG_NO_BRANCH,
  MSG_NO_REMOTE,
  MSG_OFFLINE,
  MSG_SSH_REMOTE,
  SYNC_SNAPSHOT_MESSAGE,
} from "./sync-messages.ts";
import type { GitCache, RemoteTransport } from "./sync-types.ts";

/**
 * The git repo directory for a project dir. A project IS its git repo, so this
 * walks up to the enclosing repo root (opening a subfolder syncs the whole
 * repo — plain git, no per-book scoping). Anything unclassifiable is itself.
 */
export async function repoDirFor(projectDir: string): Promise<string> {
  const source = await detectProjectSource(projectDir);
  if (source.type === "local-git-folder") return gitScopeFor(source);
  return projectDir;
}

/**
 * True when a stored credential may be transmitted to `url`: over https to
 * anywhere, or over http ONLY to loopback (a local git daemon or the in-memory
 * test server). Deep-analysis SECURITY fix: the protocol gates elsewhere accept
 * http:// too, so without this a repo-scoped account token was sent as cleartext
 * Basic auth to a remote http host — harvestable by anyone on the path. Loopback
 * http carries no network exposure, so it stays allowed.
 */
export function isCredentialTransmissionSafe(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") {
      // WHATWG URL keeps the brackets on IPv6 literals: "[::1]", never "::1".
      const host = u.hostname.toLowerCase();
      return host === "127.0.0.1" || host === "[::1]" || host === "localhost";
    }
    return false;
  } catch {
    return false;
  }
}

export function onAuthFor(credential: HostCredential | undefined) {
  if (!credential) return {};
  return {
    onAuth: (url: string) => {
      // Never leak the token over cleartext (see isCredentialTransmissionSafe).
      // Throw the typed error LOUDLY: silently withholding the credential made
      // the server's 401 classify as "auth" → "reconnect" guidance → a forever
      // loop, and recover-auth then deleted the credential for the whole host.
      // isomorphic-git only calls onAuth on a real auth challenge, so public
      // http remotes keep working unauthenticated.
      if (!isCredentialTransmissionSafe(url)) throw new InsecureTransportError();
      // Same convention as clone.ts: GitHub accepts any username with the
      // token as password (covers OAuth gho_ and legacy ghu_ tokens); plain
      // tokens use the stored username (or the token-as-username convention
      // every smart-HTTPS forge accepts).
      return {
        username:
          credential.kind === "github-oauth"
            ? "x-access-token"
            : credential.username || credential.token,
        password: credential.token,
      };
    },
  };
}

/**
 * Resolve the project's tracked remote + credential. Throws friendly errors
 * for the no-remote / SSH cases (the UI should have gated on diagnose, but
 * the lib must stay safe to call directly).
 */
export async function resolveTransport(
  dir: string,
  options: { credential?: HostCredential; tokenStore?: TokenStore },
): Promise<RemoteTransport> {
  // The ONE remote-resolution rule, shared with detectProjectSource
  // (syncRemoteFor) — "which remote / is there a remote" must have a single
  // answer across detection, diagnosis, and this transport.
  const origin = await syncRemoteFor(dir);
  if (!origin?.url) throw new Error(MSG_NO_REMOTE);

  const { cleanUrl, credential: urlCredential } = extractUrlCredential(origin.url);
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    throw new Error(MSG_SSH_REMOTE);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(MSG_SSH_REMOTE);
  // The ONE canonical host-key derivation, shared with diagnose and every
  // credential writer — see credentialHostKey. Ad-hoc per-site derivation is
  // how stored credentials became invisible to their own remote's lookups.
  const host = credentialHostKey(cleanUrl);

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
 * The failure arms of {@link SyncOutcome}. Decoding delegates to the shared recovery classifier
 * (classifyTransportFailure): auth_required → "auth", network_unavailable →
 * "offline", insecure_transport → "error" with its dedicated message (NEVER
 * "auth" — reconnecting can't fix an http:// address, and the auth recovery
 * path deletes the stored credential), anything else → the generic "error" arm.
 */
export function failureOutcome(
  e: unknown,
  snapshotId?: string,
): { status: "auth" | "offline" | "error"; message: string; snapshotId?: string } {
  const kind = classifyTransportFailure(e);
  const base = snapshotId ? { snapshotId } : {};
  if (kind === "auth_required") return { status: "auth", message: MSG_AUTH, ...base };
  if (kind === "network_unavailable") return { status: "offline", message: MSG_OFFLINE, ...base };
  if (kind === "insecure_transport") {
    return { status: "error", message: MSG_INSECURE_TRANSPORT, ...base };
  }
  return {
    status: "error",
    message:
      "Syncing didn't complete. Your work is saved on this computer — please try again.",
    ...base,
  };
}

/** Friendly setup-problem message for the expected gate errors, else null. */
export function setupErrorMessage(e: unknown): string | null {
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
 * Snapshot-first step used by syncProject
 * (ADR 0006 D5): commit any unsaved work in the WHOLE repo BEFORE any network
 * or merge step, so a forced post-merge checkout can never discard it. The
 * working-tree check runs lazily at action time on the caller's function-scoped
 * object cache (released with the operation).
 */
export async function snapshotBeforeAction(args: {
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
    // Share the operation's cache so the rest of the sync (merge, checkout)
    // reads the index this commit just wrote — see SnapshotOptions.cache.
    cache,
  });
  return snap.id;
}

/**
 * Structural preflight — never touch the tree of a damaged repo. An interrupted
 * merge/rebase/cherry-pick, detached HEAD, stale lock, or missing `.git` must be
 * REPAIRED before any sync work: snapshot-first would otherwise commit whatever
 * is on disk (e.g. the literal conflict markers a half-done native-git merge
 * leaves in tracked files) and push it to every collaborator. Throwing the
 * typed error routes the caller through the recover() path.
 * `checkLocalChanges: false` — only the structural flags matter here.
 *
 * Runs INSIDE the caller's repo lock.
 */
export async function assertNoStructuralDamage(
  projectDir: string,
  logger: OperationLogger,
): Promise<void> {
  const health = await inspectRepo({ repoDir: projectDir }, { checkLocalChanges: false });
  const structural = classifyFromHealth(health);
  if (structural) {
    logger.warn("sync", "structural preflight blocked sync", { kind: structural });
    throw new RepoNeedsRecoveryError(structural);
  }
}

export async function currentBranchOrThrow(dir: string): Promise<string> {
  const branch = await git.currentBranch({ fs, dir });
  if (!branch) throw new Error(MSG_NO_BRANCH);
  return branch;
}

/** Resolve `ref` to an oid, or null when the ref does not exist. */
async function resolveRefOrNull(dir: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir, ref });
  } catch {
    return null;
  }
}

/**
 * Run `fn` (a fetch that moves ONE remote-tracking ref) with a rollback guard
 * (deep-analysis R15): isomorphic-git updates `refs/remotes/<remote>/<branch>`
 * from the ref advertisement BEFORE collecting the packfile, so an abort
 * mid-transfer (e.g. the defaultGitHttp idle timeout) leaves the ref pointing
 * at an oid with no local object. Such a dangling ref poisons the next fetch —
 * zero `have`s → the server streams the ENTIRE repository (the OOM
 * `fetchRemoteTip`'s `ref` choice exists to prevent) — and resolving it reports
 * missing-object "corruption" on a never-corrupt repo.
 *
 * If `fn` throws and the ref moved to an oid whose object is MISSING locally,
 * it is restored to its previous oid (or DELETED if it did not exist before).
 * A ref whose object DID land is kept — the pack made it. On success no ref is
 * touched.
 *
 * Every read here is best-effort and never masks `fn`'s error: a damaged ref
 * store must not block the guarded fetch, because the recovery handlers run on
 * exactly such repos and skipping `fn` would skip the repair itself. An
 * unreadable pre-scan simply degrades to the delete-if-dangling arm.
 */
export async function guardTrackingRef<T>(
  dir: string,
  ref: string,
  cache: GitCache,
  fn: () => Promise<T>,
): Promise<T> {
  const before = await resolveRefOrNull(dir, ref);
  try {
    return await fn();
  } catch (e) {
    try {
      const after = await resolveRefOrNull(dir, ref);
      if (after && after !== before) {
        const landed = await git.readObject({ fs, dir, oid: after, cache }).then(
          () => true,
          () => false,
        );
        if (!landed) {
          if (before) await git.writeRef({ fs, dir, ref, value: before, force: true });
          else await git.deleteRef({ fs, dir, ref });
        }
      }
    } catch {
      // Best-effort rollback — the original transport error must surface.
    }
    throw e;
  }
}

/**
 * Fetch the tracked branch's online tip. Returns `null` when the online
 * repository has no such branch yet (a freshly created empty repo).
 */
export async function fetchRemoteTip(
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
    // guardTrackingRef keeps that invariant true across aborted transfers.
    const trackingRef = `refs/remotes/${transport.remote}/${branch}`;
    const result = await guardTrackingRef(dir, trackingRef, cache, () =>
      git.fetch({
        fs,
        http,
        dir,
        cache,
        remote: transport.remote,
        ref: trackingRef,
        remoteRef: branch,
        singleBranch: true,
        tags: false,
        ...onAuthFor(transport.credential),
      }),
    );
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
export function short(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 8) : "none";
}
