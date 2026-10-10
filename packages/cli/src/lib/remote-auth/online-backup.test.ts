/**
 * Online backup set-up (#358). GitHub's REST API is a stubbed `fetch`; the git
 * side is REAL isomorphic-git against the in-process smart-HTTP test server
 * (an EMPTY bare repository standing in for a just-created GitHub repo). No
 * network, no system git.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../project-source.ts";
import { providerFor } from "../source-provider.ts";
import { isValidRepositoryName, setUpOnlineBackup } from "./online-backup.ts";
import { startGitServer, tempDir, type GitServer } from "./test-support/git-http-server.ts";
import type { HostCredential } from "./token-store.ts";

const CRED: HostCredential = {
  host: "github.com",
  kind: "github-oauth",
  token: "gho_tok",
  createdAt: 0,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let server: GitServer;
let serverDir: string;
let parent: string;
let projectDir: string;

function repoJson(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    full_name: `octocat/${name}`,
    private: true,
    default_branch: "main",
    html_url: `https://github.com/octocat/${name}`,
    clone_url: server.url,
    owner: { login: "octocat" },
    ...extra,
  };
}

/** A stub of the three GitHub endpoints the flow touches. */
function githubStub(opts: {
  create?: Response;
  repo?: Response;
  branches?: unknown[];
  offline?: boolean;
}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (opts.offline) throw new TypeError("fetch failed");
    if (method === "POST" && u.endsWith("/user/repos")) return opts.create ?? json(repoJson("my-book"), 201);
    if (u.includes("/branches")) return json(opts.branches ?? []);
    if (u.includes("/repos/")) return opts.repo ?? json(repoJson("my-book"));
    throw new Error(`unexpected request ${method} ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(async () => {
  // The "online" side: an EMPTY bare repository, like a fresh GitHub repo.
  serverDir = await tempDir("gp-backup-server-");
  await git.init({ fs, dir: serverDir, bare: true, defaultBranch: "main" });
  server = await startGitServer(serverDir, {
    requireAuth: { username: "x-access-token", password: CRED.token },
  });
  // The book: a local versioned folder with two versions.
  parent = await tempDir("gp-backup-book-");
  projectDir = path.join(parent, "book");
  fs.mkdirSync(projectDir);
  await writeFile(path.join(projectDir, "manifest.yaml"), "title: My Book\n");
  await writeFile(path.join(projectDir, "chapter-01.md"), "# One\n");
  const author = { authorName: "Author", authorEmail: "a@test.local" };
  const source = await detectProjectSource(projectDir);
  await providerFor(source).initVersionHistory({ projectDir, initialMessage: "First", ...author });
  await writeFile(path.join(projectDir, "chapter-01.md"), "# One\n\nMore.\n");
  await providerFor(await detectProjectSource(projectDir)).snapshot({
    projectDir,
    message: "Second",
    ...author,
  });
});

afterEach(async () => {
  await server.close();
  await rm(serverDir, { recursive: true, force: true });
  await rm(parent, { recursive: true, force: true });
});

const serverTip = () => git.resolveRef({ fs, gitdir: serverDir, ref: "main" });
const localTip = () => git.resolveRef({ fs, dir: projectDir, ref: "main" });
const remotes = () => git.listRemotes({ fs, dir: projectDir });

describe("setUpOnlineBackup — create a new repository", () => {
  test("creates a private repo, adds the remote and pushes the whole history", async () => {
    const stub = githubStub({});
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result.status).toBe("connected");
    if (result.status !== "connected") return;
    expect(result.repository.fullName).toBe("octocat/my-book");

    // Private by default, created empty.
    const create = stub.calls.find((c) => c.method === "POST")!;
    expect(create.body).toMatchObject({ name: "my-book", private: true, auto_init: false });

    // The remote is the plain repo address (no credential in it) and the
    // server now holds the book's history.
    expect(await remotes()).toEqual([{ remote: "origin", url: server.url }]);
    expect(await serverTip()).toBe(await localTip());
    const log = await git.log({ fs, gitdir: serverDir, ref: "main" });
    expect(log.map((c) => c.commit.message.trim())).toEqual(["Second", "First"]);

    // The book now classifies like an Open-from-GitHub one.
    const source = await detectProjectSource(projectDir);
    expect(source.type === "local-git-folder" && source.hasRemote).toBe(true);
  });

  test("a public repo is created only when asked for", async () => {
    const stub = githubStub({});
    await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book", private: false },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(stub.calls.find((c) => c.method === "POST")!.body).toMatchObject({ private: false });
  });

  test("name already taken: plain message, book untouched, nothing pushed", async () => {
    const stub = githubStub({
      create: json(
        { message: "Repository creation failed.", errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" }] },
        422,
      ),
    });
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "name-taken" });
    expect((result as { message: string }).message).toContain('"my-book"');
    expect(await remotes()).toEqual([]);
  });

  test.each(["", "   ", "has space", "bad/name", "..", "a".repeat(101)])(
    "rejects the invalid name %p without calling GitHub",
    async (name) => {
      const stub = githubStub({});
      const result = await setUpOnlineBackup({
        projectDir,
        target: { kind: "create", name },
        credential: CRED,
        fetchImpl: stub.fetchImpl,
      });
      expect(result).toMatchObject({ status: "failed", reason: "invalid-name" });
      expect(stub.calls).toEqual([]);
    },
  );

  test("GitHub refusing creation (403) points at creating one on github.com", async () => {
    const stub = githubStub({ create: json({ message: "Forbidden" }, 403) });
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "no-permission" });
    expect((result as { message: string }).message).toContain("github.com");
  });

  test("expired connection (401) asks to reconnect", async () => {
    const stub = githubStub({ create: json({ message: "Bad credentials" }, 401) });
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "auth" });
    expect((result as { message: string }).message).toMatch(/reconnect github/i);
  });

  test("offline: plain message, book untouched", async () => {
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: githubStub({ offline: true }).fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "offline" });
    expect(await remotes()).toEqual([]);
  });

  test("a push that fails is rolled back and hands back the created repository", async () => {
    // The server demands a different password: GitHub accepted the create but
    // refuses the push.
    await server.close();
    server = await startGitServer(serverDir, {
      requireAuth: { username: "x-access-token", password: "someone-else" },
    });
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: githubStub({}).fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "auth" });
    expect((result as { repository?: { fullName: string } }).repository?.fullName).toBe(
      "octocat/my-book",
    );
    // The book is back to a local-only history.
    expect(await remotes()).toEqual([]);
    const source = await detectProjectSource(projectDir);
    expect(source.type === "local-git-folder" && source.hasRemote).toBe(false);
  });
});

describe("setUpOnlineBackup — choose an existing repository", () => {
  const existing = { kind: "existing", owner: "octocat", name: "my-book" } as const;

  test("an empty repository gets the book's history", async () => {
    const stub = githubStub({});
    const result = await setUpOnlineBackup({
      projectDir,
      target: existing,
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result.status).toBe("connected");
    expect(stub.calls.some((c) => c.method === "POST")).toBe(false);
    expect(await serverTip()).toBe(await localTip());
  });

  test("a repository that already has branches is refused as not empty", async () => {
    const stub = githubStub({ branches: [{ name: "main" }] });
    const result = await setUpOnlineBackup({
      projectDir,
      target: existing,
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "not-empty" });
    expect(await remotes()).toEqual([]);
  });

  test("not found / archived or read-only repositories get their own messages", async () => {
    const notFound = await setUpOnlineBackup({
      projectDir,
      target: existing,
      credential: CRED,
      fetchImpl: githubStub({ repo: json({ message: "Not Found" }, 404) }).fetchImpl,
    });
    expect(notFound).toMatchObject({ status: "failed", reason: "not-found" });

    for (const extra of [{ archived: true }, { permissions: { push: false } }]) {
      const res = await setUpOnlineBackup({
        projectDir,
        target: existing,
        credential: CRED,
        fetchImpl: githubStub({ repo: json(repoJson("my-book", extra)) }).fetchImpl,
      });
      expect(res).toMatchObject({ status: "failed", reason: "no-permission" });
    }
  });
});

describe("setUpOnlineBackup — preconditions", () => {
  test("no saved GitHub connection", async () => {
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      tokenStore: { get: async () => null, set: async () => {}, delete: async () => {}, list: async () => [] },
      fetchImpl: githubStub({}).fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "not-connected" });
  });

  test("the saved connection is read from the token store", async () => {
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      tokenStore: { get: async (h) => (h === "github.com" ? CRED : null), set: async () => {}, delete: async () => {}, list: async () => [] },
      fetchImpl: githubStub({}).fetchImpl,
    });
    expect(result.status).toBe("connected");
  });

  test("a plain folder (no version history) is told to turn history on first", async () => {
    const plain = path.join(parent, "plain");
    fs.mkdirSync(plain);
    await writeFile(path.join(plain, "manifest.yaml"), "title: Plain\n");
    const stub = githubStub({});
    const result = await setUpOnlineBackup({
      projectDir: plain,
      target: { kind: "create", name: "plain" },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "no-history" });
    expect(stub.calls).toEqual([]);
  });

  test("a book that already has an online copy is left alone", async () => {
    await git.addRemote({ fs, dir: projectDir, remote: "origin", url: "https://github.com/o/r.git" });
    const stub = githubStub({});
    const result = await setUpOnlineBackup({
      projectDir,
      target: { kind: "create", name: "my-book" },
      credential: CRED,
      fetchImpl: stub.fetchImpl,
    });
    expect(result).toMatchObject({ status: "failed", reason: "already-has-remote" });
    expect(stub.calls).toEqual([]);
  });
});

test("isValidRepositoryName follows GitHub's rules", () => {
  expect(isValidRepositoryName("my-book_1.0")).toBe(true);
  expect(isValidRepositoryName("my book")).toBe(false);
  expect(isValidRepositoryName(".")).toBe(false);
  expect(isValidRepositoryName("")).toBe(false);
});
