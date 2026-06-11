import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileTokenStore,
  extractUrlCredential,
  migrateUrlCredential,
  redactCredential,
  type HostCredential,
} from "./token-store";

async function tempStore(): Promise<{ dir: string; store: FileTokenStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-tokens-"));
  return { dir, store: new FileTokenStore(path.join(dir, "credentials.json")) };
}

function cred(host: string, token = "gho_secret123"): HostCredential {
  return { host, kind: "github-oauth", token, username: "octocat", createdAt: Date.now() };
}

test("set/get/delete round-trips credentials keyed by host", async () => {
  const { dir, store } = await tempStore();
  try {
    expect(await store.get("github.com")).toBeNull();
    await store.set("github.com", cred("github.com"));
    const got = await store.get("github.com");
    expect(got?.token).toBe("gho_secret123");
    expect(got?.username).toBe("octocat");
    // Host lookup is case-insensitive.
    expect((await store.get("GitHub.com"))?.token).toBe("gho_secret123");
    expect((await store.list()).length).toBe(1);
    await store.delete("github.com");
    expect(await store.get("github.com")).toBeNull();
    expect(await store.list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("credential file is written with 0600 permissions", async () => {
  const { dir, store } = await tempStore();
  try {
    await store.set("github.com", cred("github.com"));
    if (process.platform === "win32") {
      // Windows has no POSIX mode bits: chmod is a no-op there and stat
      // reports the default 0o666. The store file lives under the user's
      // profile directory, protected by NTFS ACLs — assert it exists and
      // leave the mode check to POSIX platforms.
      expect((await stat(store.filePath)).isFile()).toBe(true);
    } else {
      const mode = (await stat(store.filePath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt store file degrades to empty, not a crash", async () => {
  const { dir, store } = await tempStore();
  try {
    await store.set("github.com", cred("github.com"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.filePath, "{not json", "utf8");
    expect(await store.get("github.com")).toBeNull();
    // And it recovers on the next write.
    await store.set("github.com", cred("github.com", "tok2"));
    expect((await store.get("github.com"))?.token).toBe("tok2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("redactCredential masks the token value", () => {
  const redacted = redactCredential(cred("github.com", "gho_supersecret"));
  expect(JSON.stringify(redacted)).not.toContain("gho_supersecret");
  expect(redacted.username).toBe("octocat");
});

test("extractUrlCredential strips token-in-username (GitHub style)", () => {
  const { cleanUrl, credential } = extractUrlCredential(
    "https://ghp_tok123@github.com/owner/repo.git",
  );
  expect(cleanUrl).toBe("https://github.com/owner/repo.git");
  expect(credential?.host).toBe("github.com");
  expect(credential?.token).toBe("ghp_tok123");
  expect(credential?.username).toBeUndefined();
});

test("extractUrlCredential strips user:token pairs", () => {
  const { cleanUrl, credential } = extractUrlCredential(
    "https://alice:s3cret@git.example.com/owner/repo.git",
  );
  expect(cleanUrl).toBe("https://git.example.com/owner/repo.git");
  expect(credential?.host).toBe("git.example.com");
  expect(credential?.token).toBe("s3cret");
  expect(credential?.username).toBe("alice");
});

test("extractUrlCredential passes through clean and non-http URLs", () => {
  expect(extractUrlCredential("https://github.com/o/r.git")).toEqual({
    cleanUrl: "https://github.com/o/r.git",
  });
  expect(extractUrlCredential("git@github.com:o/r.git").credential).toBeUndefined();
});

test("migrateUrlCredential stores the token and never persists it in the URL", async () => {
  const { dir, store } = await tempStore();
  try {
    const clean = await migrateUrlCredential(
      "https://alice:s3cret@git.example.com/owner/repo.git",
      store,
    );
    expect(clean).toBe("https://git.example.com/owner/repo.git");
    expect((await store.get("git.example.com"))?.token).toBe("s3cret");
    // An existing stored credential wins over one fossilized in a URL.
    const clean2 = await migrateUrlCredential(
      "https://alice:older@git.example.com/owner/repo.git",
      store,
    );
    expect(clean2).toBe("https://git.example.com/owner/repo.git");
    expect((await store.get("git.example.com"))?.token).toBe("s3cret");
    // The on-disk file never contains a URL-embedded token form.
    const raw = await readFile(store.filePath, "utf8");
    expect(raw).not.toContain("alice:s3cret@");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
