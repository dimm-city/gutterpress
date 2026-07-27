import { test, expect } from "bun:test";
import {
  listGitHubRepositories,
  listGitHubBranches,
  listRepoBooks,
} from "./github-repos";
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
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url);
    requested.push(u);
    if (u.includes("/user/repos?")) {
      const page = new URL(u).searchParams.get("page");
      return jsonResponse(page === "1" ? page1 : page2);
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

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
  const fetchImpl = (async () => jsonResponse({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
  await expect(listGitHubRepositories(CRED, { fetchImpl })).rejects.toThrow(
    /reconnect github/i,
  );
});

test("network failure maps to the offline message", async () => {
  const fetchImpl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await expect(listGitHubRepositories(CRED, { fetchImpl })).rejects.toThrow(
    /couldn't reach github/i,
  );
});

test("listBranches paginates and sends the documented headers", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }));
  const page2 = [{ name: "main" }];
  let sawHeaders: Record<string, string> | null = null;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const page = new URL(String(url)).searchParams.get("page");
    return jsonResponse(page === "1" ? page1 : page2);
  }) as unknown as typeof fetch;

  const branches = await listGitHubBranches(CRED, "octocat", "book", { fetchImpl });
  expect(branches.length).toBe(101);
  expect(branches.at(-1)!.name).toBe("main");
  expect(sawHeaders!["Accept"]).toBe("application/vnd.github+json");
  expect(sawHeaders!["Authorization"]).toBe("Bearer gho_tok");
  expect(sawHeaders!["X-GitHub-Api-Version"]).toBeTruthy();
});

// ── listRepoBooks (multi-book repositories) ──────────────────────────────────

function treeResponse(
  entries: Array<{ path: string; type: "blob" | "tree"; sha?: string }>,
  truncated = false,
) {
  return jsonResponse({
    tree: entries.map((e) => ({ sha: "0".repeat(40), ...e })),
    truncated,
  });
}

test("listRepoBooks finds canonical and legacy manifests (root counts)", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url);
    requested.push(u);
    return treeResponse([
      { path: "manifest.yaml", type: "blob" },
      { path: "books", type: "tree" },
      { path: "books/field-guide", type: "tree" },
      { path: "books/field-guide/manifest.yaml", type: "blob" },
      { path: "books/op-manual", type: "tree" },
      { path: "books/op-manual/manifest.yml", type: "blob" },
      { path: "books/op-manual/chapter-01.md", type: "blob" },
      // The persisted legacy filename matches; similar names do not.
      { path: "books/notes/not-print-md.yaml", type: "blob" },
      { path: "books/notes/print-md.yaml", type: "blob" },
      { path: "books/notes/print-md.yaml.bak", type: "blob" },
    ]);
  }) as unknown as typeof fetch;

  const books = await listRepoBooks(CRED, "octocat", "books", "main", { fetchImpl });
  expect(books).toEqual([
    { path: "", name: "books" },
    { path: "books/field-guide", name: "field-guide" },
    { path: "books/notes", name: "notes" },
    { path: "books/op-manual", name: "op-manual" },
  ]);
  // One recursive tree call against the chosen branch.
  expect(requested.length).toBe(1);
  expect(requested[0]).toContain("/repos/octocat/books/git/trees/main?recursive=1");
});

test("listRepoBooks returns [] when no manifest exists anywhere", async () => {
  const fetchImpl = (async () =>
    treeResponse([
      { path: "README.md", type: "blob" },
      { path: "src", type: "tree" },
      { path: "src/index.ts", type: "blob" },
    ])) as unknown as typeof fetch;
  const books = await listRepoBooks(CRED, "octocat", "code", "main", { fetchImpl });
  expect(books).toEqual([]);
});

test("listRepoBooks does not infer unsupported print-md.yml", async () => {
  const fetchImpl = (async () =>
    treeResponse([
      { path: "print-md.yml", type: "blob" },
      { path: "books/unsupported/print-md.yml", type: "blob" },
    ])) as unknown as typeof fetch;

  const books = await listRepoBooks(CRED, "octocat", "books", "main", { fetchImpl });
  expect(books).toEqual([]);
});

test("listRepoBooks truncated tree → falls back to root + top-level dir scans", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url);
    requested.push(u);
    if (u.includes("?recursive=1")) {
      // Truncated recursive listing: incomplete, must not be trusted.
      return treeResponse([{ path: "partial.md", type: "blob" }], true);
    }
    if (u.includes("/git/trees/main")) {
      // Non-recursive root: a manifest at the root + two top-level dirs.
      return jsonResponse({
        tree: [
          { path: "manifest.yaml", type: "blob", sha: "a".repeat(40) },
          { path: "field-guide", type: "tree", sha: "b".repeat(40) },
          { path: "assets", type: "tree", sha: "c".repeat(40) },
        ],
        truncated: false,
      });
    }
    if (u.includes(`/git/trees/${"b".repeat(40)}`)) {
      return treeResponse([{ path: "manifest.yml", type: "blob" }]);
    }
    if (u.includes(`/git/trees/${"c".repeat(40)}`)) {
      return treeResponse([{ path: "logo.png", type: "blob" }]);
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const books = await listRepoBooks(CRED, "octocat", "big", "main", { fetchImpl });
  expect(books).toEqual([
    { path: "", name: "big" },
    { path: "field-guide", name: "field-guide" },
  ]);
  // 1 recursive + 1 root + 2 per-dir probes.
  expect(requested.length).toBe(4);
});

test("listRepoBooks maps 401 to the reconnect message", async () => {
  const fetchImpl = (async () => jsonResponse({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
  await expect(
    listRepoBooks(CRED, "octocat", "books", "main", { fetchImpl }),
  ).rejects.toThrow(/reconnect github/i);
});
