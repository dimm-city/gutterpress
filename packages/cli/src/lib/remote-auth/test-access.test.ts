/**
 * testRemoteAccess tests (#14, ADR 0006 D7) — run against the same real git
 * smart-HTTP wire-protocol server the clone tests use. No transport mocking.
 */
import { test, expect } from "bun:test";
import { rm } from "node:fs/promises";

import { isSshRemoteUrl, testRemoteAccess } from "./test-access";
import type { HostCredential } from "./token-store";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "./test-support/git-http-server";

const CRED: HostCredential = {
  host: "127.0.0.1",
  kind: "token",
  token: "s3cret",
  username: "alice",
  createdAt: 0,
};

test("happy path: reachable repo reports ok with refCount and defaultBranch", async () => {
  const repoDir = await tempDir("pmd-access-src-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir);
    const result = await testRemoteAccess({ url: server.url });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.refCount).toBeGreaterThanOrEqual(1);
      expect(result.defaultBranch).toBe("main");
    }
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("auth-required server without a credential classifies as auth", async () => {
  const repoDir = await tempDir("pmd-access-auth-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "alice", password: "s3cret" },
    });
    const result = await testRemoteAccess({ url: server.url });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("auth");
      // The friendly message never echoes URLs or tokens.
      expect(result.message).not.toContain("127.0.0.1");
    }
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("auth-required server with the right credential succeeds (token kind → Basic auth)", async () => {
  const repoDir = await tempDir("pmd-access-cred-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "alice", password: "s3cret" },
    });
    const result = await testRemoteAccess({ url: server.url, credential: CRED });
    expect(result.ok).toBe(true);
    expect(server.authHeaders.some((h) => h?.startsWith("Basic "))).toBe(true);
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("a credential embedded in the URL is used and never echoed (D7)", async () => {
  const repoDir = await tempDir("pmd-access-urlcred-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "alice", password: "s3cret" },
    });
    const u = new URL(server.url);
    const result = await testRemoteAccess({
      url: `http://alice:s3cret@${u.host}${u.pathname}`,
    });
    expect(result.ok).toBe(true);
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("404 host classifies as not-found", async () => {
  const repoDir = await tempDir("pmd-access-404-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, { notFound: true });
    const result = await testRemoteAccess({ url: server.url });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found");
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("connection-refused classifies as unreachable", async () => {
  // A just-closed server's port refuses connections.
  const repoDir = await tempDir("pmd-access-refused-");
  try {
    await createFixtureRepo(repoDir);
    const server = await startGitServer(repoDir);
    const url = server.url;
    await server.close();
    const result = await testRemoteAccess({ url });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("SSH URLs classify as ssh-unsupported with no network call", async () => {
  for (const url of [
    "git@github.com:octocat/book.git",
    "ssh://git@gitea.example.com/octo/book.git",
  ]) {
    const result = await testRemoteAccess({ url });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ssh-unsupported");
      expect(result.message).toMatch(/usual git tool/i);
    }
  }
});

test("isSshRemoteUrl recognizes scp-like and ssh:// forms, not https", () => {
  expect(isSshRemoteUrl("git@github.com:o/r.git")).toBe(true);
  expect(isSshRemoteUrl("ssh://git@host/o/r.git")).toBe(true);
  // scp-like with a bracketed IPv6 host.
  expect(isSshRemoteUrl("git@[::1]:owner/repo.git")).toBe(true);
  expect(isSshRemoteUrl("https://github.com/o/r.git")).toBe(false);
  // userinfo in an https URL is NOT scp-like.
  expect(isSshRemoteUrl("https://alice:tok@host/o/r.git")).toBe(false);
});

test("IPv6 scp-like URLs classify as ssh-unsupported with no network call", async () => {
  const result = await testRemoteAccess({ url: "git@[::1]:owner/repo.git" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("ssh-unsupported");
});

test("non-URL garbage classifies as unknown", async () => {
  const result = await testRemoteAccess({ url: "not a url at all" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("unknown");
});

// ── Insecure transport: the probe must obey the same cleartext gate as sync ──
//
// A fake isomorphic-git http client that answers 401 until an Authorization
// header arrives, then serves a minimal v1 refs advertisement. It records the
// Authorization header of every request so a token leak is directly visible.
function makeAuthChallengeClient() {
  const authHeaders: (string | undefined)[] = [];
  const oid = "1234567890abcdef1234567890abcdef12345678";
  const pkt = (s: string) => (s.length + 4).toString(16).padStart(4, "0") + s;
  const advertisement =
    pkt("# service=git-upload-pack\n") +
    "0000" +
    pkt(`${oid} HEAD\0symref=HEAD:refs/heads/main\n`) +
    pkt(`${oid} refs/heads/main\n`) +
    "0000";
  const client = {
    async request(config: { url: string; headers?: Record<string, string> }) {
      const auth = config.headers?.Authorization ?? config.headers?.authorization;
      authHeaders.push(auth);
      if (!auth) {
        return {
          url: config.url,
          method: "GET",
          statusCode: 401,
          statusMessage: "Unauthorized",
          headers: {},
          body: (async function* () {})(),
        };
      }
      return {
        url: config.url,
        method: "GET",
        statusCode: 200,
        statusMessage: "OK",
        headers: { "content-type": "application/x-git-upload-pack-advertisement" },
        body: (async function* () {
          yield new TextEncoder().encode(advertisement);
        })(),
      };
    },
  } as unknown as NonNullable<Parameters<typeof testRemoteAccess>[0]["httpClient"]>;
  return { client, authHeaders };
}

test("non-loopback http + stored credential: token is NEVER sent, classified insecure-transport", async () => {
  const { client, authHeaders } = makeAuthChallengeClient();
  const result = await testRemoteAccess({
    url: "http://git.example.com/owner/repo.git",
    credential: CRED,
    httpClient: client,
  });
  // The probe must agree with real sync: no cleartext Basic auth, ever —
  // reporting "Connected" here while sync withholds the credential lies.
  expect(authHeaders.filter(Boolean)).toEqual([]);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("insecure-transport");
    expect(result.message).toMatch(/https/i);
    expect(result.message).not.toContain(CRED.token);
  }
});

test("same probe over https still authenticates (Basic auth sent once challenged)", async () => {
  const { client, authHeaders } = makeAuthChallengeClient();
  const result = await testRemoteAccess({
    url: "https://git.example.com/owner/repo.git",
    credential: CRED,
    httpClient: client,
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.defaultBranch).toBe("main");
  expect(authHeaders.some((h) => h?.startsWith("Basic "))).toBe(true);
});
