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

// ── Enclosing-repo detection (book subfolders of a larger repo) ──────────────

test("folder nested inside a repo → local-git-folder scoped to its subPath", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      path.join(gitDir, "config"),
      `[remote "origin"]\n\turl = https://github.com/owner/books.git\n`,
    );
    const inner = path.join(dir, "books", "field-guide");
    await mkdir(inner, { recursive: true });

    const source = await detectProjectSource(inner);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      // The book USES the enclosing repo's history, scoped to its folder.
      expect(source.repoRoot).toBe(dir);
      expect(source.subPath).toBe("books/field-guide");
      expect(source.hasRemote).toBe(true);
      expect(source.remoteUrl).toBe("https://github.com/owner/books.git");
      expect(source.branch).toBe("main");
    }
    const caps = capabilitiesFor(source);
    // Full version-history features — the subfolder shares the parent's
    // history rather than being told to move to its own folder.
    expect(caps.canEnableVersionHistory).toBe(false);
    expect(caps.canSnapshot).toBe(true);
    expect(caps.canViewHistory).toBe(true);
    expect(caps.canRestoreSnapshot).toBe(true);
    expect(caps.canSync).toBe(true);
    expect(caps.canWriteLocal).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a repo-root project keeps repoRoot === path and subPath ''", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    const source = await detectProjectSource(dir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.repoRoot).toBe(dir);
      expect(source.subPath).toBe("");
    }
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
    if (source.type === "local-git-folder") {
      // Its OWN repo, not the enclosing one.
      expect(source.repoRoot).toBe(inner);
      expect(source.subPath).toBe("");
    }
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

// ── Corrupt / missing HEAD must stay a (damaged) repo, not a plain folder ─────
//
// A repo whose `.git/HEAD` is MISSING or unreadable is a CORRUPT repository, NOT
// a pristine `local-folder`. It MUST still classify as `local-git-folder` so the
// recovery subsystem treats it as a damaged repo to repair (re-fetch/re-attach)
// rather than a brand-new folder to "set up a remote" for. The `.git/` directory
// is the sole signal — HEAD readability only affects `branch`, never the type.
// (Classification is gated on `isDirectory(.git)`, so HEAD damage can never make
// it fall through to `local-folder`; these tests lock that invariant.)

test("'.git' dir present but HEAD MISSING → local-git-folder, branch undefined (NOT local-folder)", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    // A repo whose HEAD was lost (e.g. interrupted write / truncated checkout).
    // Write a config so it clearly looks like a repo, but NO HEAD file at all.
    await writeFile(
      path.join(gitDir, "config"),
      "[core]\n\trepositoryformatversion = 0\n",
    );
    const source = await detectProjectSource(dir);
    // The damaged repo is still a repo — never a pristine folder.
    expect(source.type).toBe("local-git-folder");
    expect(source.type).not.toBe("local-folder");
    if (source.type === "local-git-folder") {
      expect(source.repoRoot).toBe(dir);
      expect(source.subPath).toBe("");
      expect(source.branch).toBeUndefined();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("'.git' dir present with GARBAGE HEAD → local-git-folder, branch undefined", async () => {
  const dir = await tempDir();
  try {
    const gitDir = path.join(dir, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(
      path.join(gitDir, "config"),
      "[core]\n\trepositoryformatversion = 0\n",
    );
    // Non-ref, non-SHA garbage — parseHeadBranch must yield undefined, and the
    // folder must remain a (damaged) repo.
    await writeFile(path.join(gitDir, "HEAD"), "this is not a valid HEAD\n");
    const source = await detectProjectSource(dir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.repoRoot).toBe(dir);
      expect(source.branch).toBeUndefined();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a truly plain folder (no .git ANYWHERE) still returns local-folder", async () => {
  const dir = await tempDir();
  try {
    // Sanity counter-case: without any `.git` up the tree, it is NOT a repo.
    const source = await detectProjectSource(dir);
    expect(source).toEqual({ type: "local-folder", path: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseHeadBranch returns undefined for garbage / empty HEAD content", () => {
  // Detached HEAD (raw SHA) and outright garbage both yield no branch name.
  expect(parseHeadBranch("not a ref at all")).toBeUndefined();
  expect(parseHeadBranch("")).toBeUndefined();
  expect(
    parseHeadBranch("ref: refs/tags/v1.0.0\n"),
  ).toBeUndefined(); // a tag ref is not a branch
});
