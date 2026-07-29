/**
 * GitHub repo discovery (#15, ADR 0006 D3 layer 4).
 *
 * Plain `fetch` against the GitHub REST API — deliberately no `@octokit`
 * dependency. Lists every repository the user can access (`GET /user/repos`,
 * the OAuth `repo`-scope model — ADR 0006 D1 amendment 2026-06-10), the
 * branches of a chosen repository, and (via the Git Trees API) the gutterpress
 * book projects inside a repo. The two REST listings paginate; the Git Trees
 * call is a single request that handles the API's `truncated` flag instead. All
 * three time out explicitly and map failures to author-friendly messages
 * (401 → "reconnect").
 */
import type { HostCredential } from "./token-store.ts";
import { withFetchTimeout } from "../fetch-timeout.ts";
import { githubApiHeaders, OFFLINE_MESSAGE } from "./github-auth.ts";
import { MANIFEST_FILENAMES } from "../manifest.ts";

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const PER_PAGE = 100;
/** Hard cap on pagination so a pathological account can't loop forever. */
const MAX_PAGES = 50;

/** One repository the user can open from GitHub. */
export interface RemoteRepository {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

/** One branch of a remote repository. */
export interface RemoteBranch {
  name: string;
}

export interface GitHubApiOptions {
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** "Reconnect" message for revoked/expired tokens (ADR 0006 D7). */
export const RECONNECT_MESSAGE =
  "Your GitHub connection has expired. Reconnect GitHub and try again.";

async function apiGet(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
): Promise<Response> {
  // Shared deadline + offline mapping (../fetch-timeout.ts).
  const res = await withFetchTimeout(
    { timeoutMs: REQUEST_TIMEOUT_MS, offlineMessage: OFFLINE_MESSAGE },
    (signal) =>
      fetchImpl(url, { method: "GET", headers: githubApiHeaders(token), signal }),
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(RECONNECT_MESSAGE);
  }
  if (!res.ok) {
    // No URL echo — the path is boring but the message must stay author-safe.
    throw new Error(
      `GitHub returned an unexpected error (HTTP ${res.status}). Please try again.`,
    );
  }
  return res;
}

type UserReposPage = Array<{
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner: { login: string };
}>;

/**
 * List every repository the user can access — own, collaborator, and org
 * member — via `GET /user/repos` (paginated). The OAuth `repo` scope makes
 * the full set visible with zero install/selection steps (ADR 0006 D1
 * amendment). `sort=pushed` puts recently-active books first; callers must
 * PRESERVE this order (the picker renders it as "most recent first").
 */
export async function listGitHubRepositories(
  credential: HostCredential,
  options: GitHubApiOptions = {},
): Promise<RemoteRepository[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const repos: RemoteRepository[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiGet(
      fetchImpl,
      `${API_BASE}/user/repos?per_page=${PER_PAGE}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      credential.token,
    );
    const body = (await res.json()) as UserReposPage;
    for (const r of body) {
      repos.push({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        htmlUrl: r.html_url,
      });
    }
    if (body.length < PER_PAGE) break;
  }
  return repos;
}

/** One Gutterpress book found inside a repository. */
export interface RepoBook {
  /**
   * Folder of the book relative to the repository root, forward-slash form.
   * Empty string when the manifest sits at the repository root.
   */
  path: string;
  /** Display name: the folder's basename, or the repo name for the root. */
  name: string;
}

const MANIFEST_NAMES = new Set<string>(MANIFEST_FILENAMES);

function isManifestPath(filePath: string): boolean {
  return MANIFEST_NAMES.has(filePath.slice(filePath.lastIndexOf("/") + 1));
}

type TreeEntry = { path?: string; type?: string; sha?: string };
type TreeResponse = { tree?: TreeEntry[]; truncated?: boolean };

function bookFromManifestPath(manifestPath: string, repo: string): RepoBook {
  const dir = manifestPath.replace(/\/?[^/]*$/, "");
  return { path: dir, name: dir === "" ? repo : dir.split("/").pop()! };
}

/**
 * Find the Gutterpress books inside a repository branch: every directory that
 * contains a recognized manifest (from `MANIFEST_FILENAMES`) — the repository
 * root counts, with `path: ""`. Uses one
 * `GET /repos/{owner}/{repo}/git/trees/{branch}
 * ?recursive=1` call; when GitHub truncates the recursive listing (very large
 * repositories) it falls back to scanning the root + each top-level directory
 * with non-recursive tree calls, so the result stays correct for the common
 * "books are top-level folders" layout. Results are sorted by path, root
 * first.
 */
export async function listRepoBooks(
  credential: HostCredential,
  owner: string,
  repo: string,
  branch: string,
  options: GitHubApiOptions = {},
): Promise<RepoBook[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ownerEnc = encodeURIComponent(owner);
  const repoEnc = encodeURIComponent(repo);
  const treeUrl = (ref: string, recursive: boolean) =>
    `${API_BASE}/repos/${ownerEnc}/${repoEnc}/git/trees/${encodeURIComponent(ref)}${
      recursive ? "?recursive=1" : ""
    }`;

  const res = await apiGet(fetchImpl, treeUrl(branch, true), credential.token);
  const body = (await res.json()) as TreeResponse;
  const entries = body.tree ?? [];

  if (!body.truncated) {
    const books = entries
      .filter((e) => e.type === "blob" && e.path && isManifestPath(e.path))
      .map((e) => bookFromManifestPath(e.path!, repo));
    return dedupeAndSortBooks(books);
  }

  // Truncated listing: fall back to the root tree + each top-level directory
  // (bounded — one request per top-level dir, capped).
  const rootRes = await apiGet(fetchImpl, treeUrl(branch, false), credential.token);
  const rootBody = (await rootRes.json()) as TreeResponse;
  const rootEntries = rootBody.tree ?? [];
  const books: RepoBook[] = rootEntries
    .filter((e) => e.type === "blob" && e.path && isManifestPath(e.path))
    .map((e) => bookFromManifestPath(e.path!, repo));
  const topDirs = rootEntries
    .filter((e) => e.type === "tree" && typeof e.path === "string" && typeof e.sha === "string")
    .slice(0, MAX_TRUNCATED_DIR_SCANS);
  for (const dirEntry of topDirs) {
    // Address each top-level directory by its tree SHA (always present in the
    // parent listing) — branch:path ref syntax is not a documented API form.
    const subRes = await apiGet(fetchImpl, treeUrl(dirEntry.sha!, false), credential.token);
    const subBody = (await subRes.json()) as TreeResponse;
    const hasManifest = (subBody.tree ?? []).some(
      (e) => e.type === "blob" && e.path && isManifestPath(e.path),
    );
    if (hasManifest) {
      books.push({ path: dirEntry.path!, name: dirEntry.path! });
    }
  }
  return dedupeAndSortBooks(books);
}

/** Bound on per-directory probes in the truncated-tree fallback. */
const MAX_TRUNCATED_DIR_SCANS = 50;

function dedupeAndSortBooks(books: RepoBook[]): RepoBook[] {
  const byPath = new Map<string, RepoBook>();
  for (const b of books) if (!byPath.has(b.path)) byPath.set(b.path, b);
  return [...byPath.values()].sort((a, b) =>
    a.path === b.path ? 0 : a.path === "" ? -1 : b.path === "" ? 1 : a.path < b.path ? -1 : 1,
  );
}

/** List a repository's branches via `GET /repos/{owner}/{repo}/branches`. */
export async function listGitHubBranches(
  credential: HostCredential,
  owner: string,
  repo: string,
  options: GitHubApiOptions = {},
): Promise<RemoteBranch[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ownerEnc = encodeURIComponent(owner);
  const repoEnc = encodeURIComponent(repo);
  const branches: RemoteBranch[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiGet(
      fetchImpl,
      `${API_BASE}/repos/${ownerEnc}/${repoEnc}/branches?per_page=${PER_PAGE}&page=${page}`,
      credential.token,
    );
    const body = (await res.json()) as Array<{ name: string }>;
    branches.push(...body.map((b) => ({ name: b.name })));
    if (body.length < PER_PAGE) break;
  }
  return branches;
}
