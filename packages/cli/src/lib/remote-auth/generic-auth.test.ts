/**
 * Generic token provider tests (#14, ADR 0006 D3) — validate-before-save
 * against the real smart-HTTP test server, plus the forge token-URL helper.
 */
import { test, expect } from "bun:test";
import { rm } from "node:fs/promises";

import httpNode from "isomorphic-git/http/node";

import {
  GenericTokenAuthProvider,
  connectGenericHost,
  knownForgeTokenUrl,
  normalizeForgeHost,
} from "./generic-auth";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "./test-support/git-http-server";

test("connect validates against the repo URL and returns a token credential", async () => {
  const repoDir = await tempDir("pmd-generic-ok-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "alice", password: "tok_123" },
    });
    const u = new URL(server.url);
    const credential = await connectGenericHost({
      host: u.host,
      username: "alice",
      token: "tok_123",
      repoUrl: server.url,
    });
    expect(credential.kind).toBe("token");
    expect(credential.host).toBe(u.host); // hostname:port, lower-case
    expect(credential.username).toBe("alice");
    expect(credential.token).toBe("tok_123");
    expect(credential.label).toContain("alice");
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("connect with a rejected token fails BEFORE save, friendly and token-free", async () => {
  const repoDir = await tempDir("pmd-generic-bad-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "alice", password: "right_token" },
    });
    const u = new URL(server.url);
    let thrown: Error | null = null;
    try {
      await connectGenericHost({
        host: u.host,
        username: "alice",
        token: "wrong_token",
        repoUrl: server.url,
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/didn't accept that access token/i);
    expect(thrown!.message).not.toContain("wrong_token");
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("connect against an unreachable server fails with guidance", async () => {
  const repoDir = await tempDir("pmd-generic-unreach-");
  try {
    await createFixtureRepo(repoDir);
    const server = await startGitServer(repoDir);
    const u = new URL(server.url);
    await server.close();
    await expect(
      connectGenericHost({ host: u.host, token: "tok", repoUrl: `http://${u.host}/x.git` }),
    ).rejects.toThrow(/couldn't reach/i);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("KNOWN LIMITATION: root probe accepts a wrong token when the host root is not a git endpoint", async () => {
  // Documents the connectGenericHost root-probe behavior: without a repoUrl
  // the probe hits the host root, and a host that answers 404 everywhere
  // (i.e. the root is not a git endpoint) is ACCEPTED — even though the
  // token was never actually verified against anything. See the doc comment
  // on connectGenericHost. Pass repoUrl for full end-to-end verification.
  const repoDir = await tempDir("pmd-generic-rootprobe-");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, { notFound: true });
    const u = new URL(server.url);
    // The root probe is built as https://host/ — the test server is plain
    // http, so inject a transport that downgrades the scheme.
    const httpClient = {
      request: (config: Parameters<typeof httpNode.request>[0]) =>
        httpNode.request({
          ...config,
          url: config.url.replace(/^https:/, "http:"),
        }),
    } as typeof httpNode;
    const credential = await connectGenericHost(
      {
        host: u.host,
        token: "completely_wrong_token",
        // no repoUrl → root probe; the 404 answer is treated as
        // inconclusive-but-reachable and the credential is accepted.
      },
      { httpClient },
    );
    expect(credential.kind).toBe("token");
    expect(credential.token).toBe("completely_wrong_token");
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("validate() keeps the credential when the probe is inconclusive (unreachable host)", async () => {
  // Pins the "can't tell → keep" policy: only a definitive auth rejection
  // invalidates a stored credential. An unreachable host (laptop offline,
  // VPN down) must NOT log the user out.
  const repoDir = await tempDir("pmd-generic-validate-");
  await createFixtureRepo(repoDir);
  const server = await startGitServer(repoDir);
  const u = new URL(server.url);
  await server.close(); // port now refuses connections → unreachable
  try {
    const provider = new GenericTokenAuthProvider({ timeoutMs: 3_000 });
    const ok = await provider.validate({
      host: u.host,
      kind: "token",
      token: "tok_123",
      createdAt: 0,
    });
    expect(ok).toBe(true);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}, 20_000);

test("connect rejects SSH-looking input and empty host/token with guidance", async () => {
  await expect(
    connectGenericHost({ host: "git.example.com", token: "t", repoUrl: "git@host:o/r.git" }),
  ).rejects.toThrow(/https/i);
  await expect(connectGenericHost({ host: "   ", token: "t" })).rejects.toThrow(
    /web address/i,
  );
  await expect(
    connectGenericHost({ host: "git.example.com", token: "  " }),
  ).rejects.toThrow(/access token/i);
});

test("GenericTokenAuthProvider matches any https host except github.com", () => {
  const provider = new GenericTokenAuthProvider();
  expect(provider.matches(new URL("https://gitea.example.com/o/r.git"))).toBe(true);
  expect(provider.matches(new URL("https://gitlab.com/o/r.git"))).toBe(true);
  expect(provider.matches(new URL("https://github.com/o/r.git"))).toBe(false);
  expect(provider.matches(new URL("ssh://git@host/o/r.git"))).toBe(false);
});

test("normalizeForgeHost accepts hostnames, URLs, and ports", () => {
  expect(normalizeForgeHost("Git.Example.com")).toBe("git.example.com");
  expect(normalizeForgeHost("https://git.example.com/owner/repo")).toBe("git.example.com");
  expect(normalizeForgeHost("git.example.com:3000")).toBe("git.example.com:3000");
  expect(normalizeForgeHost("")).toBe("");
  expect(normalizeForgeHost("   ")).toBe("");
});

test("knownForgeTokenUrl deep links for recognized forges, null otherwise", () => {
  expect(knownForgeTokenUrl("gitea.example.com")).toBe(
    "https://gitea.example.com/user/settings/applications",
  );
  expect(knownForgeTokenUrl("forgejo.example.org")).toBe(
    "https://forgejo.example.org/user/settings/applications",
  );
  expect(knownForgeTokenUrl("gitlab.com")).toBe(
    "https://gitlab.com/-/user_settings/personal_access_tokens",
  );
  expect(knownForgeTokenUrl("gitlab.mycompany.dev")).toBe(
    "https://gitlab.mycompany.dev/-/user_settings/personal_access_tokens",
  );
  expect(knownForgeTokenUrl("bitbucket.org")).toBe(
    "https://bitbucket.org/account/settings/app-passwords/",
  );
  expect(knownForgeTokenUrl("dev.azure.com")).toBe(
    "https://dev.azure.com/_usersSettings/tokens",
  );
  // GitHub uses the managed device flow — never a pasted token.
  expect(knownForgeTokenUrl("github.com")).toBeNull();
  expect(knownForgeTokenUrl("git.example.com")).toBeNull();
});
