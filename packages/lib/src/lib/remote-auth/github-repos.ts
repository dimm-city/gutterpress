/**
 * GitHub repo discovery (#15, ADR 0006 D3 layer 4).
 *
 * Plain `fetch` against ~3 REST endpoints — deliberately no `@octokit`
 * dependency. Lists the repositories the user granted the print-md GitHub App
 * access to (installation-scoped, i.e. "selected repositories"), plus the
 * branches of a chosen repository. All calls paginate, time out explicitly,
 * and map failures to author-friendly messages (401 → "reconnect").
 */
import type { HostCredential } from "./token-store.ts";
import { githubApiHeaders, OFFLINE_MESSAGE } from "./github-auth.ts";

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
  /** The GitHub App installation that grants access to this repo. */
  installationId: string;
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
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: githubApiHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(OFFLINE_MESSAGE, { cause });
  }
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

interface InstallationsPage {
  total_count: number;
  installations: Array<{ id: number }>;
}

interface InstallationReposPage {
  total_count: number;
  repositories: Array<{
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
    owner: { login: string };
  }>;
}

/**
 * List every repository the user has granted the print-md GitHub App, across
 * all of their installations (personal account + orgs). Endpoints:
 * `GET /user/installations` then
 * `GET /user/installations/{installation_id}/repositories` (both paginated).
 */
export async function listGitHubRepositories(
  credential: HostCredential,
  options: GitHubApiOptions = {},
): Promise<RemoteRepository[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const installations: number[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiGet(
      fetchImpl,
      `${API_BASE}/user/installations?per_page=${PER_PAGE}&page=${page}`,
      credential.token,
    );
    const body = (await res.json()) as InstallationsPage;
    installations.push(...body.installations.map((i) => i.id));
    if (body.installations.length < PER_PAGE) break;
  }

  const repos: RemoteRepository[] = [];
  for (const installationId of installations) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await apiGet(
        fetchImpl,
        `${API_BASE}/user/installations/${installationId}/repositories?per_page=${PER_PAGE}&page=${page}`,
        credential.token,
      );
      const body = (await res.json()) as InstallationReposPage;
      for (const r of body.repositories) {
        repos.push({
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch,
          htmlUrl: r.html_url,
          installationId: String(installationId),
        });
      }
      if (body.repositories.length < PER_PAGE) break;
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return repos;
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
