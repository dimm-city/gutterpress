/**
 * git-fs.ts — atomic writes for git's mutable metadata.
 *
 * The load-bearing test is the LAST one: it runs a real snapshot through the
 * real snapshot path and proves the atomic write actually engaged, rather than
 * proving the wrapper merely exists. The proof is file IDENTITY. A plain
 * truncate-in-place write keeps the same inode; temp-file + `rename` replaces
 * the directory entry, so the inode necessarily CHANGES. Revert git-fs.ts and
 * that test fails — which is exactly what makes it a proof.
 *
 * TEST RUNNER: bun:test only.
 */
import { describe, expect, test } from "bun:test";

import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import git from "isomorphic-git";

import { needsAtomicWrite, writeFile as atomicWriteFile } from "./git-fs.ts";
import { snapshotWorkingTreeUnlocked } from "./source-provider.ts";

describe("needsAtomicWrite", () => {
  test("git's mutable metadata is atomic", () => {
    for (const p of [
      "/book/.git/index",
      "/book/.git/HEAD",
      "/book/.git/packed-refs",
      "/book/.git/refs/heads/main",
      "/book/.git/refs/remotes/origin/main",
    ]) {
      expect(needsAtomicWrite(p)).toBe(true);
    }
  });

  test("objects and working-tree files keep the plain write", () => {
    for (const p of [
      // Content-addressed: written once under a hash, never overwritten.
      "/book/.git/objects/ab/cdef",
      // The author's own files — including ones named like git metadata.
      "/book/chapters/index",
      "/book/index.md",
      "/book/HEAD",
      "/book/refs/notes.md",
    ]) {
      expect(needsAtomicWrite(p)).toBe(false);
    }
  });

  test("a non-string path is never atomic (file descriptors pass through)", () => {
    expect(needsAtomicWrite(3)).toBe(false);
    expect(needsAtomicWrite(undefined)).toBe(false);
  });
});

describe("the atomic write itself", () => {
  test("replaces the target and leaves no temp file behind", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gp-gitfs-"));
    try {
      const gitDir = path.join(dir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });
      const index = path.join(gitDir, "index");
      await writeFile(index, "old");

      await new Promise<void>((resolve, reject) =>
        atomicWriteFile(index, "new", undefined, (e) => (e ? reject(e) : resolve())),
      );

      expect(await readFile(index, "utf8")).toBe("new");
      expect(fs.readdirSync(gitDir)).toEqual(["index"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── The proof: it engages on a real snapshot ─────────────────────────────────

/** A real git repo with one commit, ready to snapshot into. */
async function makeRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "gp-gitfs-snap-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter-01.md"), "# One\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  await git.commit({
    fs,
    dir,
    message: "first",
    author: { name: "A", email: "a@example.com" },
  });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("a real snapshot REPLACES .git/index instead of truncating it in place", async () => {
  const h = await makeRepo();
  try {
    const indexPath = path.join(h.dir, ".git", "index");
    const before = fs.statSync(indexPath).ino;

    await writeFile(path.join(h.dir, "chapter-01.md"), "# One\n\nA new paragraph.\n");
    await snapshotWorkingTreeUnlocked({
      projectDir: h.dir,
      repoRoot: h.dir,
      message: "second",
      authorName: "A",
      authorEmail: "a@example.com",
    });

    const after = fs.statSync(indexPath).ino;
    // A truncate-in-place write keeps the inode; rename-into-place changes it.
    // This is what proves the snapshot path went through git-fs.ts.
    expect(after).not.toBe(before);
    // And the snapshot really happened — the index is a working index, not a
    // stray temp file that happened to land on the name.
    expect(fs.readdirSync(path.join(h.dir, ".git")).some((f) => f.endsWith(".tmp"))).toBe(
      false,
    );
    const [head] = await git.log({ fs, dir: h.dir, depth: 1 });
    expect(head?.commit.message.trim()).toBe("second");
  } finally {
    await h.cleanup();
  }
});

test("a real snapshot REPLACES the branch ref instead of truncating it", async () => {
  const h = await makeRepo();
  try {
    const refPath = path.join(h.dir, ".git", "refs", "heads", "main");
    const before = fs.statSync(refPath).ino;

    await writeFile(path.join(h.dir, "chapter-01.md"), "# One\n\nMore.\n");
    await snapshotWorkingTreeUnlocked({
      projectDir: h.dir,
      repoRoot: h.dir,
      message: "third",
      authorName: "A",
      authorEmail: "a@example.com",
    });

    expect(fs.statSync(refPath).ino).not.toBe(before);
  } finally {
    await h.cleanup();
  }
});
