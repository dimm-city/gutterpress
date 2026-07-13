/**
 * Credential host-key agreement (2026-07 git-subsystem review).
 *
 * "Connected successfully but never syncable again" defects all reduced to
 * the same root cause: every write/read site derived the credential-store key
 * its own way (the device flow hardcoded `github.com`, the URL migration
 * dropped `:port`, generic connect kept `www.`), so a credential stored by
 * one flow was invisible to another's lookup. These tests pin the ONE
 * canonical derivation ({@link credentialHostKey}) and — the part unit tests
 * of each site can't see — that a credential stored by each WRITER is found
 * by the READERS (`diagnoseProjectRemote`) for the same remote, on real
 * on-disk repo fixtures.
 */
import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  credentialHostKey,
  extractUrlCredential,
  FileTokenStore,
} from "./token-store";
import { normalizeForgeHost } from "./generic-auth";
import { GITHUB_HOST } from "./github-auth";
import { diagnoseProjectRemote } from "./diagnose";

// ── The canonical derivation ─────────────────────────────────────────────────

test("credentialHostKey: one answer for every input shape", () => {
  // Bare hosts, case, www.
  expect(credentialHostKey("github.com")).toBe("github.com");
  expect(credentialHostKey("GitHub.Com")).toBe("github.com");
  expect(credentialHostKey("www.github.com")).toBe("github.com");
  // URLs (with and without explicit ports; default ports are dropped).
  expect(credentialHostKey("https://www.github.com/o/r.git")).toBe("github.com");
  expect(credentialHostKey("https://git.example.com:3000/o/r.git")).toBe("git.example.com:3000");
  expect(credentialHostKey("https://git.example.com:443/o/r.git")).toBe("git.example.com");
  // host:port input (what a user types into generic connect).
  expect(credentialHostKey("git.example.com:3000")).toBe("git.example.com:3000");
  // scp-like SSH.
  expect(credentialHostKey("git@github.com:o/r.git")).toBe("github.com");
  // Unusable input.
  expect(credentialHostKey("")).toBe("");
  expect(credentialHostKey("   ")).toBe("");
});

test("normalizeForgeHost delegates to the canonical derivation", () => {
  expect(normalizeForgeHost("Git.Example.com:3000/x")).toBe(
    credentialHostKey("git.example.com:3000"),
  );
  expect(normalizeForgeHost("https://www.github.com/o/r")).toBe(GITHUB_HOST);
});

test("extractUrlCredential keys the migrated credential with the port kept", () => {
  const { credential, cleanUrl } = extractUrlCredential(
    "https://alice:s3cret@git.example.com:3000/o/r.git",
  );
  expect(credential?.host).toBe("git.example.com:3000");
  expect(credential?.token).toBe("s3cret");
  expect(cleanUrl).not.toContain("s3cret");
});

// ── Writer→reader round-trips on real repo fixtures ──────────────────────────

async function repoWithRemote(remoteUrl: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-hostkey-"));
  const gitDir = path.join(dir, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    path.join(gitDir, "config"),
    `[remote "origin"]\n\turl = ${remoteUrl}\n`,
  );
  return dir;
}

async function storeIn(dir: string): Promise<FileTokenStore> {
  return new FileTokenStore(path.join(dir, "credentials.json"));
}

test("round-trip: generic connect key (host:port) is found by diagnose for the same remote", async () => {
  const repo = await repoWithRemote("https://git.example.com:3000/o/r.git");
  try {
    const store = await storeIn(repo);
    await store.set(normalizeForgeHost("git.example.com:3000"), {
      host: normalizeForgeHost("git.example.com:3000"),
      kind: "token",
      token: "tok",
      createdAt: 1,
    });
    const diag = await diagnoseProjectRemote(repo, { tokenStore: store });
    expect(diag.credentialPresent).toBe(true);
    expect(diag.canSync).toBe(true);
    expect(diag.guidance).toBe("ready-to-sync");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("round-trip: the device-flow key (github.com) is found for a www.github.com remote", async () => {
  // A hand-typed clone URL with `www.` used to loop forever: guidance said
  // "connect GitHub", the device flow stored under `github.com`, and the
  // lookup asked for `www.github.com` — never found.
  const repo = await repoWithRemote("https://www.github.com/o/r.git");
  try {
    const store = await storeIn(repo);
    await store.set(GITHUB_HOST, {
      host: GITHUB_HOST,
      kind: "github-oauth",
      token: "gho_x",
      createdAt: 1,
    });
    const diag = await diagnoseProjectRemote(repo, { tokenStore: store });
    expect(diag.remoteHost).toBe("github.com");
    expect(diag.credentialPresent).toBe(true);
    expect(diag.canSync).toBe(true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("a token embedded in the remote URL counts as a present credential (transport uses it)", async () => {
  const repo = await repoWithRemote("https://tok123@git.example.com/o/r.git");
  try {
    const store = await storeIn(repo); // empty store — only the URL carries auth
    const diag = await diagnoseProjectRemote(repo, { tokenStore: store });
    expect(diag.credentialPresent).toBe(true);
    expect(diag.canSync).toBe(true);
    // D7: the token never surfaces in the diagnosis.
    expect(diag.remoteUrl).not.toContain("tok123");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

// ── Syncability truth table (protocol × credential) ──────────────────────────

test("canSync truth table: https+cred → sync; https−cred → connect; ssh → own tools; none → local", async () => {
  const cases: Array<{
    remote: string | null;
    cred: boolean;
    canSync: boolean;
    guidance: string;
  }> = [
    { remote: "https://github.com/o/r.git", cred: true, canSync: true, guidance: "ready-to-sync" },
    { remote: "https://github.com/o/r.git", cred: false, canSync: false, guidance: "connect-github-to-sync" },
    { remote: "https://git.example.com/o/r.git", cred: false, canSync: false, guidance: "https-connect-server" },
    { remote: "git@github.com:o/r.git", cred: false, canSync: false, guidance: "ssh-use-own-tools" },
    { remote: null, cred: false, canSync: false, guidance: "local-only" },
  ];
  for (const c of cases) {
    const repo = c.remote
      ? await repoWithRemote(c.remote)
      : await (async () => {
          const dir = await mkdtemp(path.join(tmpdir(), "pmd-hostkey-"));
          const gitDir = path.join(dir, ".git");
          await mkdir(gitDir, { recursive: true });
          await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
          await writeFile(path.join(gitDir, "config"), "[core]\n");
          return dir;
        })();
    try {
      const store = await storeIn(repo);
      if (c.cred && c.remote) {
        const key = credentialHostKey(c.remote);
        await store.set(key, { host: key, kind: "token", token: "t", createdAt: 1 });
      }
      const diag = await diagnoseProjectRemote(repo, { tokenStore: store });
      expect(`${c.remote} → ${diag.canSync}/${diag.guidance}`).toBe(
        `${c.remote} → ${c.canSync}/${c.guidance}`,
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
});
