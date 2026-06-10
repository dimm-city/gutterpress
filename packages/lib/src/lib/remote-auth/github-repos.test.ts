import { test, expect } from "bun:test";
import { listGitHubRepositories, listGitHubBranches } from "./github-repos";
import type { HostCredential } from "./token-store";

const CRED: HostCredential = {
  host: "github.com",
  kind: "github-oauth",
  token: "gho_tok",
  createdAt: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repoBody(name: string) {
  return {
    name,
    full_name: `octocat/${name}`,
    private: true,
    default_branch: "main",
    html_url: `https://github.com/octocat/${name}`,
    owner: { login: "octocat" },
  };
}

test("lists user repos via /user/repos with pagination (2 pages), preserving API order", async () => {
  // 100 repos on page 1 (full page → fetch page 2), 1 repo on page 2. The
  // names are deliberately NOT alphabetical: the API's sort=pushed order
  // (most recently pushed first) must be preserved, never re-sorted.
  const page1 = [
    repoBody("zz-most-recent"),
    ...Array.from({ length: 99 }, (_, i) => repoBody(`book-${String(i).padStart(3, "0")}`)),
  ];
  const page2 = [repoBody("aa-oldest")];
  const requested: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const u = String(url);
    requested.push(u);
    if (u.includes("/user/repos?")) {
      const page = new URL(u).searchParams.get("page");
      return jsonResponse(page === "1" ? page1 : page2);
    }
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;

  const repos = await listGitHubRepositories(CRED, { fetchImpl });
  expect(repos.length).toBe(101);
  expect(repos[0]!.fullName).toBe("octocat/zz-most-recent");
  expect(repos.at(-1)!.fullName).toBe("octocat/aa-oldest");
  expect(repos[0]!.defaultBranch).toBe("main");
  // Both pages were fetched, with the sort + affiliation params on each.
  expect(requested.length).toBe(2);
  for (const u of requested) {
    const params = new URL(u).searchParams;
    expect(params.get("sort")).toBe("pushed");
    expect(params.get("affiliation")).toBe("owner,collaborator,organization_member");
    expect(params.get("per_page")).toBe("100");
  }
});

test("401 maps to a reconnect message", async () => {
  const fetchImpl = (async () => jsonResponse({ message: "Bad credentials" }, 401)) as typeof fetch;
  await expect(listGitHubRepositories(CRED, { fetchImpl })).rejects.toThrow(
    /reconnect github/i,
  );
});

test("network failure maps to the offline message", async () => {
  const fetchImpl = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await expect(listGitHubRepositories(CRED, { fetchImpl })).rejects.toThrow(
    /couldn't reach github/i,
  );
});

test("listBranches paginates and sends the documented headers", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }));
  const page2 = [{ name: "main" }];
  let sawHeaders: Record<string, string> | null = null;
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const page = new URL(String(url)).searchParams.get("page");
    return jsonResponse(page === "1" ? page1 : page2);
  }) as typeof fetch;

  const branches = await listGitHubBranches(CRED, "octocat", "book", { fetchImpl });
  expect(branches.length).toBe(101);
  expect(branches.at(-1)!.name).toBe("main");
  expect(sawHeaders!["Accept"]).toBe("application/vnd.github+json");
  expect(sawHeaders!["Authorization"]).toBe("Bearer gho_tok");
  expect(sawHeaders!["X-GitHub-Api-Version"]).toBeTruthy();
});
