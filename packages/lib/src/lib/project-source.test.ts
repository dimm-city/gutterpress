import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectProjectSource,
  capabilitiesFor,
  findEnclosingRepoDir,
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
    expect(caps.canSync).toBe(false);
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
    expect(caps.canSync).toBe(false);
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

// ── Enclosing-repo detection (SWEEP-2) ───────────────────────────────────────

test("folder nested inside a repo → local-folder with enclosingRepoDir, enable suppressed", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".git"), { recursive: true });
    const inner = path.join(dir, "books", "field-guide");
    await mkdir(inner, { recursive: true });

    const source = await detectProjectSource(inner);
    expect(source.type).toBe("local-folder");
    if (source.type === "local-folder") {
      expect(source.enclosingRepoDir).toBe(dir);
    }
    const caps = capabilitiesFor(source);
    // The whole point: never offer "Enable Version History" here — a nested
    // git init would shadow the outer repo's tracking of these files.
    expect(caps.canEnableVersionHistory).toBe(false);
    expect(caps.canSnapshot).toBe(false);
    expect(caps.canViewHistory).toBe(false);
    expect(caps.canWriteLocal).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a folder's OWN .git wins over an enclosing repo (still local-git-folder)", async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, ".git"), { recursive: true });
    const inner = path.join(dir, "sub");
    const innerGit = path.join(inner, ".git");
    await mkdir(innerGit, { recursive: true });
    await writeFile(path.join(innerGit, "HEAD"), "ref: refs/heads/main\n");

    const source = await detectProjectSource(inner);
    expect(source.type).toBe("local-git-folder");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findEnclosingRepoDir returns nearest ancestor repo, undefined when none", async () => {
  const dir = await tempDir();
  try {
    const outer = path.join(dir, "outer");
    const mid = path.join(outer, "mid");
    const leaf = path.join(mid, "leaf");
    await mkdir(path.join(outer, ".git"), { recursive: true });
    await mkdir(path.join(mid, ".git"), { recursive: true });
    await mkdir(leaf, { recursive: true });

    // Nearest wins.
    expect(await findEnclosingRepoDir(leaf)).toBe(mid);
    // A `.git` FILE-less plain chain finds nothing (tmpdir has no repo above).
    const plain = path.join(dir, "plain", "deep");
    await mkdir(plain, { recursive: true });
    expect(await findEnclosingRepoDir(plain)).toBeUndefined();
    // The folder's own .git is ignored — only ANCESTORS are scanned.
    expect(await findEnclosingRepoDir(mid)).toBe(outer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
