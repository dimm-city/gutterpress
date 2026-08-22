import { test, expect, spyOn } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import {
  detectProjectSource,
  capabilitiesFor,
  findEnclosingRepoDir,
} from "./project-source";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "gutterpress-src-"));
}

/**
 * Make `<dir>/.git` look like a real repository. `gitEntryKind` requires
 * HEAD before it will call a `.git` DIRECTORY a repo — the name alone is not
 * evidence, and treating it as evidence let one stray `/tmp/.git` reclassify
 * every folder beneath it. Tests that mean "a repo lives here" must say so.
 */
async function makeGitDir(dir: string): Promise<void> {
  await mkdir(path.join(dir, ".git"), { recursive: true });
  await writeFile(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
}

test("plain folder (no .git) → local-folder", async () => {
  const dir = await tempDir();
  try {
    const source = await detectProjectSource(dir);
    expect(source).toEqual({ type: "local-folder", path: dir });
    const caps = capabilitiesFor(source);
    expect(caps.canEnableVersionHistory).toBe(true);
    expect(caps.canSnapshot).toBe(false);
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Engine parity: detection reads the config the way git itself does ────────
// Remote/branch now come from isomorphic-git (the sync engine's own machinery),
// so layouts the old hand-rolled regex missed must classify correctly.

async function repoWithConfig(dir: string, config: string, head = "ref: refs/heads/main\n") {
  const gitDir = path.join(dir, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), head);
  await writeFile(path.join(gitDir, "config"), config);
}

test("SSH remotes detected; origin preferred over other remotes", async () => {
  const dir = await tempDir();
  try {
    await repoWithConfig(
      dir,
      `[remote "upstream"]\n\turl = git@github.com:up/stream.git\n[remote "origin"]\n\turl = git@github.com:owner/repo.git\n`,
    );
    const source = await detectProjectSource(dir);
    if (source.type !== "local-git-folder") throw new Error("expected git folder");
    expect(source.remoteUrl).toBe("git@github.com:owner/repo.git");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("falls back to the first remote when no origin exists", async () => {
  const dir = await tempDir();
  try {
    await repoWithConfig(dir, `[remote "fork"]\n\turl = https://example.com/a.git\n`);
    const source = await detectProjectSource(dir);
    if (source.type !== "local-git-folder") throw new Error("expected git folder");
    expect(source.remoteUrl).toBe("https://example.com/a.git");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("case-variant sections and multi-value urls read like git itself", async () => {
  const dir = await tempDir();
  try {
    // `[Remote "origin"]` — section names are case-insensitive to git; two
    // `url =` entries — git uses the LAST. The old regex parser missed both
    // (hasRemote:false / first-url), silently disabling sync for repos the
    // engine could sync.
    await repoWithConfig(
      dir,
      `[Remote "origin"]\n\tURL = https://old.example.com/a.git\n\turl = https://new.example.com/a.git\n`,
    );
    const source = await detectProjectSource(dir);
    if (source.type !== "local-git-folder") throw new Error("expected git folder");
    expect(source.hasRemote).toBe(true);
    expect(source.remoteUrl).toBe("https://new.example.com/a.git");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a submodule-style checkout (`.git` FILE) is its OWN repo, never the superproject", async () => {
  const dir = await tempDir();
  try {
    // Superproject repo at the root, with its own remote.
    await repoWithConfig(
      dir,
      `[remote "origin"]\n\turl = https://github.com/owner/super.git\n`,
    );
    // Submodule checkout at book/: a `.git` FILE pointing into the
    // superproject's modules dir (the exact layout `git submodule` creates).
    const book = path.join(dir, "book");
    const modulesGitDir = path.join(dir, ".git", "modules", "book");
    await mkdir(book, { recursive: true });
    await mkdir(modulesGitDir, { recursive: true });
    await writeFile(path.join(modulesGitDir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      path.join(modulesGitDir, "config"),
      `[core]\n\trepositoryformatversion = 0\n\tworktree = ../../../book\n[remote "origin"]\n\turl = https://github.com/owner/book.git\n`,
    );
    await writeFile(path.join(book, ".git"), "gitdir: ../.git/modules/book\n");

    const source = await detectProjectSource(book);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      // Its OWN repo — treating it as part of the superproject pointed
      // snapshot/restore/sync at the WRONG repository.
      expect(source.repoRoot).toBe(book);
      expect(source.subPath).toBe("");
      // The SUBMODULE's remote, not the superproject's.
      expect(source.remoteUrl).toBe("https://github.com/owner/book.git");
      expect(source.branch).toBe("main");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    await makeGitDir(dir);
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
    await makeGitDir(outer);
    await makeGitDir(mid);
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

// ── Home directory must never become an enclosing repo ──────────────────────
//
// Some users keep a dotfiles-style `.git` repo directly at `$HOME`. A bare
// folder opened anywhere under home must NOT be classified as living inside
// that repo — treating home as `repoRoot` would scope snapshot/restore/sync
// to the user's entire home directory.

test("home directory itself is never treated as an enclosing repo", async () => {
  const home = await tempDir();
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(home);
  try {
    await makeGitDir(home);
    const child = path.join(home, "some-book");
    await mkdir(child, { recursive: true });

    expect(await findEnclosingRepoDir(child)).toBeUndefined();

    const source = await detectProjectSource(child);
    expect(source).toEqual({ type: "local-folder", path: child });
  } finally {
    homedirSpy.mockRestore();
    await rm(home, { recursive: true, force: true });
  }
});

test("detached HEAD (raw SHA) yields no branch name but stays a repo", async () => {
  const dir = await tempDir();
  try {
    await repoWithConfig(
      dir,
      "[core]\n\trepositoryformatversion = 0\n",
      "9fceb02d0ae598e95dc970b74767f19372d61af8\n",
    );
    const source = await detectProjectSource(dir);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.branch).toBeUndefined();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Regression: a directory named `.git` that is not a repository must not
 * reclassify everything beneath it.
 *
 * Observed for real on 2026-08-12 — a `/tmp/.git` holding one unrelated file
 * (no HEAD, no objects, no refs; `git` itself reported "not a git
 * repository") made every `mkdtemp` consumer under `/tmp` look like it lived
 * inside a versioned project. `initVersionHistory` then refused to work
 * anywhere in the OS temp dir, which failed ~8 unrelated tests with a
 * message about the user's project layout. The blast radius is what makes
 * this worth a test: `findEnclosingRepoDir` probes EVERY ancestor, so one
 * junk directory high in the tree is enough.
 */
test("a .git directory without HEAD is not a repo", async () => {
  const dir = await tempDir();
  try {
    const stray = path.join(dir, "stray");
    const leaf = path.join(stray, "project");
    await mkdir(path.join(stray, ".git"), { recursive: true });
    await writeFile(path.join(stray, ".git", "unrelated-marker"), "");
    await mkdir(leaf, { recursive: true });

    // Not an enclosing repo: the ancestor walk must see straight through it.
    expect(await findEnclosingRepoDir(leaf)).toBeUndefined();
    // The folder ITSELF is still treated as a (damaged) git folder — that
    // asymmetry is deliberate: leniency helps the folder the author opened
    // (it routes to recovery) and only hurts on ancestors nobody named.
    expect((await detectProjectSource(stray)).type).toBe("local-git-folder");

    // Add HEAD and it becomes a repo, proving HEAD is what is being tested
    // and not some incidental property of the fixture.
    await writeFile(path.join(stray, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await findEnclosingRepoDir(leaf)).toBe(stray);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
