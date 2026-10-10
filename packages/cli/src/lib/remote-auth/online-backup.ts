/**
 * Set up online backup for a book that started on this computer (#358).
 *
 * A book made in the app with version history on is a local isomorphic-git
 * repo with no remote. This connects it to GitHub in one operation:
 *
 *   1. create a new repository (`POST /user/repos`, private by default) OR
 *      verify a chosen existing one is EMPTY and writable;
 *   2. add it as `origin` (the plain https clone URL GitHub reports — no
 *      credential in the address);
 *   3. run the ordinary `syncProject`, which pushes the book's existing
 *      history to the empty repository.
 *
 * After that the book is indistinguishable from an Open-from-GitHub one: the
 * same remote, the same stored credential, the same sync and auto-sync.
 *
 * Auth model: the saved GitHub connection is an OAuth App device-flow token
 * with the `repo` scope (github-auth.ts), which covers both
 * `POST /user/repos` and pushing — no new permission or consent step.
 * Repositories are created under the author's own account; organisation
 * repositories can be chosen from the existing-repository list.
 *
 * Like `syncProject`, expected outcomes are RETURNED ({@link BackupSetupResult}),
 * never thrown, each with a plain-language message. A failed attempt leaves
 * the book exactly as it was (the remote is removed again); a repository that
 * was created before the push failed is reported back so the author can retry
 * with it (it is empty, so "choose an existing repository" accepts it).
 * Plain `fetch` + isomorphic-git only (CLAUDE.md §7).
 */
import { gitFs as fs } from "../git-fs.ts";

import git from "isomorphic-git";

import { withFetchTimeout } from "../fetch-timeout.ts";
import { detectProjectSource } from "../project-source.ts";
import { withRepoLock } from "../source-provider.ts";
import { GITHUB_HOST, githubApiHeaders } from "./github-auth.ts";
import { listGitHubBranches, type RemoteRepository } from "./github-repos.ts";
import { syncProject } from "./sync.ts";
import type { SyncOutcome, SyncProjectOptions } from "./sync-types.ts";
import { repoDirFor } from "./transport.ts";
import type { HostCredential, TokenStore } from "./token-store.ts";

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
/** GitHub's own limit on repository name length. */
const MAX_NAME_LENGTH = 100;

/** What to connect the book to. */
export type BackupTarget =
  | {
      kind: "create";
      /** Repository name (letters, numbers, `-`, `_`, `.`). */
      name: string;
      /** Defaults to private — a book is not published by backing it up. */
      private?: boolean;
    }
  | { kind: "existing"; owner: string; name: string };

export interface SetUpOnlineBackupOptions {
  projectDir: string;
  target: BackupTarget;
  /** Explicit credential; wins over the token store. */
  credential?: HostCredential;
  /** Source of the saved GitHub connection when no credential is passed. */
  tokenStore?: TokenStore;
  authorName?: string;
  authorEmail?: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable git transport for tests (passed to `syncProject`). */
  httpClient?: SyncProjectOptions["httpClient"];
  /** Operation log (passed to `syncProject`). */
  logFile?: SyncProjectOptions["logFile"];
}

export type BackupSetupFailureReason =
  | "not-connected"
  | "auth"
  | "offline"
  | "no-history"
  | "already-has-remote"
  | "invalid-name"
  | "name-taken"
  | "not-found"
  | "no-permission"
  | "not-empty"
  | "push-failed";

export type BackupSetupResult =
  | { status: "connected"; repository: RemoteRepository; sync: SyncOutcome }
  | {
      status: "failed";
      reason: BackupSetupFailureReason;
      /** Plain-language, safe to show verbatim. */
      message: string;
      /** The repository that exists online after a late failure (created or chosen). */
      repository?: RemoteRepository;
    };

const MSG = {
  notConnected:
    "Connect your GitHub account first (Settings > Accounts), then set up online backup.",
  auth: "GitHub didn't accept the saved connection. Reconnect GitHub in Settings > Accounts and try again.",
  offline:
    "Gutterpress couldn't reach GitHub. Check your internet connection and try again. Nothing was changed.",
  noHistory:
    "Turn on version history for this book first. Online backup copies the versions Gutterpress keeps on this computer.",
  alreadyHasRemote: "This book already has an online copy.",
  noName: "Give the online copy a name.",
  badName:
    "A repository name can only use letters, numbers, hyphens (-), underscores (_) and dots (.), and be at most 100 characters.",
  notFound:
    "Gutterpress couldn't find that repository on GitHub, or your account can't see it. Choose another one.",
  noPermission:
    "Your GitHub account isn't allowed to add to that repository (it may be archived or read-only). Choose another one.",
  noCreatePermission:
    "GitHub wouldn't let Gutterpress create a repository with this connection. Create an empty repository on github.com yourself, then choose it from your existing repositories here.",
  notEmpty:
    "That repository already has files in it, and online backup needs an empty one. Choose an empty repository, or create a new one.",
  pushFailed:
    "Your book couldn't be copied to GitHub. Your writing is safe on this computer. Please try again.",
} as const;

const nameTaken = (name: string) =>
  `You already have a repository named "${name}" on GitHub. Pick a different name, or choose that repository from your existing empty repositories.`;

class BackupFailure extends Error {
  constructor(
    readonly reason: BackupSetupFailureReason,
    message: string,
    readonly repository?: RemoteRepository,
  ) {
    super(message);
  }
}

/** True for a name GitHub accepts for a repository. */
export function isValidRepositoryName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name !== "." &&
    name !== ".."
  );
}

type RepoJson = {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  clone_url: string;
  archived?: boolean;
  permissions?: { push?: boolean };
  owner: { login: string };
};

function toRemoteRepository(r: RepoJson): RemoteRepository {
  return {
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
  };
}

async function request(
  fetchImpl: typeof fetch,
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return withFetchTimeout(
    { timeoutMs: REQUEST_TIMEOUT_MS, offlineMessage: MSG.offline },
    (signal) =>
      fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: {
          ...githubApiHeaders(token),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
      }),
  ).catch((e) => {
    // withFetchTimeout's mapped message is already the plain offline copy.
    throw new BackupFailure("offline", e instanceof Error ? e.message : MSG.offline);
  });
}

async function createRepository(
  fetchImpl: typeof fetch,
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<RepoJson> {
  const res = await request(fetchImpl, "POST", "/user/repos", token, {
    name,
    private: isPrivate,
    // Empty on purpose: a README would make the first push a non-empty merge.
    auto_init: false,
    description: "Online backup made with Gutterpress",
  });
  if (res.status === 201 || res.status === 200) return (await res.json()) as RepoJson;
  if (res.status === 401) throw new BackupFailure("auth", MSG.auth);
  if (res.status === 403) throw new BackupFailure("no-permission", MSG.noCreatePermission);
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as {
      errors?: Array<{ message?: string }>;
    };
    const taken = (body.errors ?? []).some((e) => /already exists/i.test(e.message ?? ""));
    throw new BackupFailure("name-taken" as const, taken ? nameTaken(name) : MSG.badName);
  }
  throw new BackupFailure("push-failed", `GitHub couldn't create the repository (error ${res.status}). Please try again.`);
}

/** Fetch a chosen repository and check it is writable and EMPTY. */
async function loadEmptyRepository(
  fetchImpl: typeof fetch,
  credential: HostCredential,
  owner: string,
  name: string,
): Promise<RepoJson> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const res = await request(fetchImpl, "GET", path, credential.token);
  if (res.status === 401) throw new BackupFailure("auth", MSG.auth);
  if (res.status === 404) throw new BackupFailure("not-found", MSG.notFound);
  if (res.status === 403) throw new BackupFailure("no-permission", MSG.noPermission);
  if (!res.ok) {
    throw new BackupFailure("push-failed", `GitHub returned an unexpected error (error ${res.status}). Please try again.`);
  }
  const repo = (await res.json()) as RepoJson;
  if (repo.archived || repo.permissions?.push === false) {
    throw new BackupFailure("no-permission", MSG.noPermission);
  }
  // An empty repository has no branches; anything else is not ours to push into.
  const branches = await listGitHubBranches(credential, owner, name, { fetchImpl }).catch((e) => {
    // listGitHubBranches words its own failures (offline / reconnect / unexpected).
    const msg = e instanceof Error ? e.message : "";
    throw new BackupFailure(/reconnect/i.test(msg) ? "auth" : /reach/i.test(msg) ? "offline" : "push-failed", msg || MSG.pushFailed);
  });
  if (branches.length > 0) throw new BackupFailure("not-empty", MSG.notEmpty, toRemoteRepository(repo));
  return repo;
}

async function run(options: SetUpOnlineBackupOptions): Promise<BackupSetupResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const credential =
    options.credential ?? (await options.tokenStore?.get(GITHUB_HOST).catch(() => null)) ?? undefined;
  if (!credential) throw new BackupFailure("not-connected", MSG.notConnected);

  // The book must have history to push, and no online copy yet.
  const source = await detectProjectSource(options.projectDir);
  if (source.type !== "local-git-folder") throw new BackupFailure("no-history", MSG.noHistory);
  if (source.hasRemote) throw new BackupFailure("already-has-remote", MSG.alreadyHasRemote);
  const dir = await repoDirFor(options.projectDir);
  const head = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
  if (!head) throw new BackupFailure("no-history", MSG.noHistory);

  const { target } = options;
  let repo: RepoJson;
  if (target.kind === "create") {
    const name = target.name.trim();
    if (!name) throw new BackupFailure("invalid-name", MSG.noName);
    if (!isValidRepositoryName(name)) throw new BackupFailure("invalid-name", MSG.badName);
    repo = await createRepository(fetchImpl, credential.token, name, target.private ?? true);
  } else {
    repo = await loadEmptyRepository(fetchImpl, credential, target.owner, target.name);
  }
  const repository = toRemoteRepository(repo);
  if (!/^https?:\/\//.test(repo.clone_url)) {
    throw new BackupFailure("push-failed", MSG.pushFailed, repository);
  }

  await withRepoLock(dir, () =>
    git.addRemote({ fs, dir, remote: "origin", url: repo.clone_url }),
  );
  const sync = await syncProject({
    projectDir: options.projectDir,
    credential,
    ...(options.authorName ? { authorName: options.authorName } : {}),
    ...(options.authorEmail ? { authorEmail: options.authorEmail } : {}),
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    ...(options.logFile ? { logFile: options.logFile } : {}),
  });
  if (sync.status === "synced" || sync.status === "up-to-date") {
    return { status: "connected", repository, sync };
  }

  // The push didn't land: put the book back exactly as it was.
  await withRepoLock(dir, () => git.deleteRemote({ fs, dir, remote: "origin" })).catch(() => {});
  if (sync.status === "auth") throw new BackupFailure("auth", sync.message, repository);
  if (sync.status === "offline") throw new BackupFailure("offline", sync.message, repository);
  throw new BackupFailure("push-failed", sync.message || MSG.pushFailed, repository);
}

/**
 * Connect a locally-versioned book to a GitHub repository and push its
 * history. Never throws for expected outcomes; see the header.
 */
export async function setUpOnlineBackup(
  options: SetUpOnlineBackupOptions,
): Promise<BackupSetupResult> {
  try {
    return await run(options);
  } catch (e) {
    if (e instanceof BackupFailure) {
      return {
        status: "failed",
        reason: e.reason,
        message: e.message,
        ...(e.repository ? { repository: e.repository } : {}),
      };
    }
    throw e;
  }
}
