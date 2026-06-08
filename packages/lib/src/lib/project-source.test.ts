import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectProjectSource,
  capabilitiesFor,
  parseRemoteUrl,
  parseHeadBranch,
} from "./project-source";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "pmd-src-"));
}

test("plain folder (no .git) → local-folder", async () => {
  const dir = await tempDir();
  try {
    const source = await detectProjectSource(dir);
    expect(source).toEqual({ type: "local-folder", path: dir });
    const caps = capabilitiesFor(source);
    expect(caps.canEnableVersionHistory).toBe(true);
    expect(caps.canSnapshot).toBe(false);
    expect(caps.canPublish).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("folder with .git but no remote → local-git-folder, hasRemote false", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      path.join(gitDir, "config"),
      "[core]\n\trepositoryformatversion = 0\n",
    );
    const source = await detectProjectSource(dir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.hasRemote).toBe(false);
      expect(source.remoteUrl).toBeUndefined();
      expect(source.branch).toBe("main");
    }
    const caps = capabilitiesFor(source);
    expect(caps.canSnapshot).toBe(true);
    expect(caps.canEnableVersionHistory).toBe(false);
    expect(caps.canPublish).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("folder with .git and an HTTPS remote → local-git-folder, hasRemote true", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/feature/x\n");
    await writeFile(
      path.join(gitDir, "config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/owner/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    );
    const source = await detectProjectSource(dir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.hasRemote).toBe(true);
      expect(source.remoteUrl).toBe("https://github.com/owner/repo.git");
      expect(source.branch).toBe("feature/x");
    }
    const caps = capabilitiesFor(source);
    expect(caps.canPublish).toBe(true);
    expect(caps.canSync).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseRemoteUrl handles SSH remotes and prefers origin", () => {
  const config = `[remote "upstream"]
\turl = git@github.com:up/stream.git
[remote "origin"]
\turl = git@github.com:owner/repo.git
`;
  expect(parseRemoteUrl(config)).toBe("git@github.com:owner/repo.git");
});

test("parseRemoteUrl falls back to first remote when no origin", () => {
  const config = `[remote "fork"]\n\turl = https://example.com/a.git\n`;
  expect(parseRemoteUrl(config)).toBe("https://example.com/a.git");
});

test("parseRemoteUrl returns undefined on empty/malformed config", () => {
  expect(parseRemoteUrl("")).toBeUndefined();
  expect(parseRemoteUrl("[core]\n\tbare = false\n")).toBeUndefined();
});

test("parseHeadBranch returns undefined on detached HEAD", () => {
  expect(parseHeadBranch("9fceb02d0ae598e95dc970b74767f19372d61af8\n")).toBeUndefined();
  expect(parseHeadBranch("ref: refs/heads/main\n")).toBe("main");
});

test("malformed .git config does not crash detection", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    // No HEAD, garbage config.
    await writeFile(path.join(gitDir, "config"), "}{ not ini at all");
    const source = await detectProjectSource(dir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.hasRemote).toBe(false);
      expect(source.branch).toBeUndefined();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
