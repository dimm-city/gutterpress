/**
 * git-fs.ts — atomic writes for git's metadata and object store, and the
 * self-heal for empty loose objects left by older builds.
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

import { gitFs, needsAtomicWrite } from "./git-fs.ts";
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

  test("the object store is atomic too (loose objects and packs)", () => {
    for (const p of [
      "/book/.git/objects/ab/cdef0123456789abcdef0123456789abcdef01",
      "/book/.git/objects/pack/pack-abc.pack",
      "/book/.git/objects/pack/pack-abc.idx",
      "C:\\Users\\a\\book\\.git\\objects\\ab\\cdef",
    ]) {
      expect(needsAtomicWrite(p)).toBe(true);
    }
  });

  test("working-tree files keep the plain write", () => {
    for (const p of [
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
        gitFs.writeFile(index, "new", (e) => (e ? reject(e) : resolve())),
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

// ── Empty loose objects (0.11.6 field report) ────────────────────────────────
//
// Quitting the app mid-sync could leave a loose object file EMPTY. isomorphic-
// git reads loose objects before packs and never rewrites one that exists, so
// every later merge failed with the masked
// "TypeError: Cannot create property 'caller' on string 'buffer error'".

const AUTHOR = { name: "A", email: "a@example.com" };

/** Two diverged branches; returns our tip's tree oid and their tip. */
async function makeDivergedRepo(): Promise<{
  dir: string;
  ourTree: string;
  theirs: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "gp-gitfs-torn-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "a.md"), "base\n");
  await git.add({ fs, dir, filepath: "a.md" });
  await git.commit({ fs, dir, author: AUTHOR, message: "base" });
  await git.branch({ fs, dir, ref: "theirs" });
  await writeFile(path.join(dir, "b.md"), "ours\n");
  await git.add({ fs, dir, filepath: "b.md" });
  const ours = await git.commit({ fs, dir, author: AUTHOR, message: "ours" });
  await git.checkout({ fs, dir, ref: "theirs" });
  await writeFile(path.join(dir, "c.md"), "theirs\n");
  await git.add({ fs, dir, filepath: "c.md" });
  const theirs = await git.commit({ fs, dir, author: AUTHOR, message: "theirs" });
  await git.checkout({ fs, dir, ref: "main" });
  const { commit } = await git.readCommit({ fs, dir, oid: ours });
  return { dir, ourTree: commit.tree, theirs, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function loosePath(dir: string, oid: string): string {
  return path.join(dir, ".git", "objects", oid.slice(0, 2), oid.slice(2));
}

/** Pack every loose object — the good copies a fetch would have downloaded. */
async function packEverything(dir: string): Promise<void> {
  const objects = path.join(dir, ".git", "objects");
  const oids = fs
    .readdirSync(objects)
    .filter((d) => /^[0-9a-f]{2}$/.test(d))
    .flatMap((d) => fs.readdirSync(path.join(objects, d)).map((f) => d + f));
  const { filename } = await git.packObjects({ fs, dir, oids, write: true });
  await git.indexPack({ fs, dir, filepath: path.join(".git", "objects", "pack", filename) });
}

test("REPRO: an empty loose object makes plain-fs merges fail with the masked TypeError", async () => {
  const h = await makeDivergedRepo();
  try {
    await packEverything(h.dir);
    fs.writeFileSync(loosePath(h.dir, h.ourTree), "");
    let caught: unknown;
    try {
      await git.merge({ fs, dir: h.dir, ours: "main", theirs: h.theirs, author: AUTHOR });
    } catch (e) {
      caught = e;
    }
    // Bun's wording differs from V8's ("Cannot create property 'caller' on
    // string 'buffer error'"); both are the TypeError the field log showed.
    expect(caught).toBeInstanceOf(TypeError);
  } finally {
    await h.cleanup();
  }
});

test("through gitFs the same repo merges: the empty object is removed and the pack copy is used", async () => {
  const h = await makeDivergedRepo();
  try {
    await packEverything(h.dir);
    fs.writeFileSync(loosePath(h.dir, h.ourTree), "");
    const result = await git.merge({
      fs: gitFs,
      dir: h.dir,
      ours: "main",
      theirs: h.theirs,
      author: AUTHOR,
    });
    expect(result.oid).toBeTruthy();
    expect(fs.existsSync(loosePath(h.dir, h.ourTree))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

test("an empty loose object with no other copy reads as missing, not as a masked TypeError", async () => {
  const h = await makeDivergedRepo();
  try {
    fs.writeFileSync(loosePath(h.dir, h.ourTree), "");
    let caught: unknown;
    try {
      await git.readTree({ fs: gitFs, dir: h.dir, oid: h.ourTree });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe("NotFoundError");
    // Removed, so the next write of this object can recreate it.
    expect(fs.existsSync(loosePath(h.dir, h.ourTree))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

test("a non-empty loose object is read untouched", async () => {
  const h = await makeDivergedRepo();
  try {
    const { tree } = await git.readTree({ fs: gitFs, dir: h.dir, oid: h.ourTree });
    expect(tree.map((e) => e.path).sort()).toEqual(["a.md", "b.md"]);
    expect(fs.existsSync(loosePath(h.dir, h.ourTree))).toBe(true);
  } finally {
    await h.cleanup();
  }
});

test("objects written through gitFs land complete and leave no temp files", async () => {
  const h = await makeRepo();
  try {
    await writeFile(path.join(h.dir, "chapter-02.md"), "# Two\n");
    await snapshotWorkingTreeUnlocked({
      projectDir: h.dir,
      repoRoot: h.dir,
      message: "objects",
      authorName: "A",
      authorEmail: "a@example.com",
    });
    const objects = path.join(h.dir, ".git", "objects");
    const files = fs
      .readdirSync(objects)
      .filter((d) => /^[0-9a-f]{2}$/.test(d))
      .flatMap((d) => fs.readdirSync(path.join(objects, d)));
    expect(files.some((f) => f.startsWith("tmp_obj_"))).toBe(false);
    const [head] = await git.log({ fs: gitFs, dir: h.dir, depth: 1 });
    expect(head?.commit.message.trim()).toBe("objects");
  } finally {
    await h.cleanup();
  }
});
