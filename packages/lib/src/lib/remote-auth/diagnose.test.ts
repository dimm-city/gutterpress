/**
 * diagnoseProjectRemote tests (#14) — folder fixtures with hand-written
 * `.git/config` + `.git/HEAD` (the same surface detectProjectSource reads),
 * plus an injected FileTokenStore for the credential-present checks.
 */
import { test, expect } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { diagnoseProjectRemote, forgeKindForHost, parseRemoteOrigin } from "./diagnose";
import { FileTokenStore } from "./token-store";
import { tempDir } from "./test-support/git-http-server";

async function gitFolder(opts: {
  remoteUrl?: string;
  branch?: string;
}): Promise<string> {
  const dir = await tempDir("pmd-diag-");
  await mkdir(path.join(dir, ".git"), { recursive: true });
  await writeFile(
    path.join(dir, ".git", "HEAD"),
    `ref: refs/heads/${opts.branch ?? "main"}\n`,
  );
  const config = opts.remoteUrl
    ? `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${opts.remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
    : `[core]\n\trepositoryformatversion = 0\n`;
  await writeFile(path.join(dir, ".git", "config"), config);
  return dir;
}

test("plain folder → local-only, no remote, nothing publishable", async () => {
  const dir = await tempDir("pmd-diag-plain-");
  try {
    const diag = await diagnoseProjectRemote(dir);
    expect(diag.classification.type).toBe("local-folder");
    expect(diag.remoteProtocol).toBe("none");
    expect(diag.remoteUrl).toBeUndefined();
    expect(diag.credentialPresent).toBe(false);
    expect(diag.provider).toBeNull();
    expect(diag.canPublishWhenImplemented).toBe(false);
    expect(diag.guidance).toBe("local-only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("git folder without a remote → local-only with branch", async () => {
  const dir = await gitFolder({ branch: "draft" });
  try {
    const diag = await diagnoseProjectRemote(dir);
    expect(diag.classification.type).toBe("local-git-folder");
    expect(diag.remoteProtocol).toBe("none");
    expect(diag.branch).toBe("draft");
    expect(diag.guidance).toBe("local-only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTPS github remote without credential → connect-github-to-publish", async () => {
  const dir = await gitFolder({ remoteUrl: "https://github.com/octo/book.git" });
  const storeDir = await tempDir("pmd-diag-store-");
  try {
    const store = new FileTokenStore(path.join(storeDir, "credentials.json"));
    const diag = await diagnoseProjectRemote(dir, { tokenStore: store });
    expect(diag.remoteProtocol).toBe("https");
    expect(diag.remoteHost).toBe("github.com");
    expect(diag.provider).toBe("github");
    expect(diag.credentialPresent).toBe(false);
    expect(diag.canPublishWhenImplemented).toBe(false);
    expect(diag.guidance).toBe("connect-github-to-publish");
    expect(diag.tokenSettingsUrl).toBeNull(); // GitHub = managed flow, no token page
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("HTTPS gitea remote with stored credential → ready-to-publish + token link", async () => {
  const dir = await gitFolder({
    remoteUrl: "https://gitea.example.com/octo/book.git",
    branch: "main",
  });
  const storeDir = await tempDir("pmd-diag-store2-");
  try {
    const store = new FileTokenStore(path.join(storeDir, "credentials.json"));
    await store.set("gitea.example.com", {
      host: "gitea.example.com",
      kind: "token",
      token: "tok",
      createdAt: 0,
    });
    const diag = await diagnoseProjectRemote(dir, { tokenStore: store });
    expect(diag.provider).toBe("gitea");
    expect(diag.credentialPresent).toBe(true);
    expect(diag.canPublishWhenImplemented).toBe(true);
    expect(diag.guidance).toBe("ready-to-publish");
    expect(diag.tokenSettingsUrl).toBe(
      "https://gitea.example.com/user/settings/applications",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("HTTPS non-GitHub remote without credential → https-connect-server", async () => {
  const dir = await gitFolder({ remoteUrl: "https://git.example.com/octo/book.git" });
  try {
    const diag = await diagnoseProjectRemote(dir);
    expect(diag.provider).toBe("generic");
    expect(diag.guidance).toBe("https-connect-server");
    expect(diag.canPublishWhenImplemented).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SSH remote → ssh-use-own-tools, never publishable, host still recognized", async () => {
  const dir = await gitFolder({ remoteUrl: "git@github.com:octo/book.git" });
  const storeDir = await tempDir("pmd-diag-store3-");
  try {
    const store = new FileTokenStore(path.join(storeDir, "credentials.json"));
    // Even WITH a stored credential, SSH can't publish (HTTPS-only transport).
    await store.set("github.com", {
      host: "github.com",
      kind: "github-app",
      token: "tok",
      createdAt: 0,
    });
    const diag = await diagnoseProjectRemote(dir, { tokenStore: store });
    expect(diag.remoteProtocol).toBe("ssh");
    expect(diag.remoteHost).toBe("github.com");
    expect(diag.provider).toBe("github"); // drives the "switch to HTTPS" hint
    expect(diag.credentialPresent).toBe(true);
    expect(diag.canPublishWhenImplemented).toBe(false);
    expect(diag.guidance).toBe("ssh-use-own-tools");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("unparseable remote URL → protocol none, provider null, local-only", async () => {
  const dir = await gitFolder({ remoteUrl: "not a url at all" });
  try {
    const diag = await diagnoseProjectRemote(dir);
    expect(diag.remoteProtocol).toBe("none");
    expect(diag.provider).toBeNull();
    expect(diag.tokenSettingsUrl).toBeNull();
    expect(diag.canPublishWhenImplemented).toBe(false);
    expect(diag.guidance).toBe("local-only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("token embedded in the remote URL never appears in the diagnosis (D7)", async () => {
  const dir = await gitFolder({
    remoteUrl: "https://alice:supersecret@git.example.com/octo/book.git",
  });
  try {
    const diag = await diagnoseProjectRemote(dir);
    expect(diag.remoteUrl).toBe("https://git.example.com/octo/book.git");
    expect(JSON.stringify(diag)).not.toContain("supersecret");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseRemoteOrigin handles https, ssh://, scp-like, and garbage", () => {
  expect(parseRemoteOrigin("https://github.com/o/r.git")).toEqual({
    protocol: "https",
    host: "github.com",
  });
  expect(parseRemoteOrigin("http://gitea.local:3000/o/r.git")).toEqual({
    protocol: "https",
    host: "gitea.local:3000",
  });
  expect(parseRemoteOrigin("ssh://git@gitlab.com/o/r.git")).toEqual({
    protocol: "ssh",
    host: "gitlab.com",
  });
  expect(parseRemoteOrigin("git@bitbucket.org:o/r.git")).toEqual({
    protocol: "ssh",
    host: "bitbucket.org",
  });
  expect(parseRemoteOrigin("")).toEqual({ protocol: "none" });
  expect(parseRemoteOrigin("not a url")).toEqual({ protocol: "none" });
});

test("forgeKindForHost classifies the supported forge families", () => {
  expect(forgeKindForHost("github.com")).toBe("github");
  expect(forgeKindForHost("gitea.example.com")).toBe("gitea");
  expect(forgeKindForHost("forgejo.example.com")).toBe("forgejo");
  expect(forgeKindForHost("gitlab.com")).toBe("gitlab");
  expect(forgeKindForHost("bitbucket.org")).toBe("bitbucket");
  expect(forgeKindForHost("dev.azure.com")).toBe("azure");
  expect(forgeKindForHost("myorg.visualstudio.com")).toBe("azure");
  expect(forgeKindForHost("git.example.com")).toBe("generic");
});
