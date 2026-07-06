import { test, expect } from "bun:test";
import { mkdir, mkdtemp, writeFile, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectProjectSource } from "./project-source";
import {
  providerFor,
  restoreVersionWithBackup,
  gitDirFor,
  listWorkdirChanges,
  RESTORE_BACKUP_MESSAGE,
  AUTO_SNAPSHOT_MESSAGE,
  isNoChangesError,
} from "./source-provider";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "pmd-provider-"));
}

/** Init version history on a plain folder and return the upgraded provider. */
async function initProject(dir: string) {
  await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nFirst draft.\n");
  const plain = providerFor({ type: "local-folder", path: dir });
  await plain.initVersionHistory({
    projectDir: dir,
    initialMessage: "Initial snapshot",
  });
  const source = await detectProjectSource(dir);
  expect(source.type).toBe("local-git-folder");
  return providerFor(source);
}

test("initVersionHistory upgrades a plain folder and commits the first snapshot", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    expect((await stat(gitDirFor(dir))).isDirectory()).toBe(true);
    const history = await provider.listHistory(dir);
    expect(history.length).toBe(1);
    expect(history[0]!.message).toBe("Initial snapshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local-folder provider rejects snapshot/restore before history is enabled", async () => {
  const dir = await tempDir();
  try {
    const provider = providerFor({ type: "local-folder", path: dir });
    await expect(
      provider.snapshot({ projectDir: dir, message: "x" }),
    ).rejects.toThrow(/no version history yet/i);
    await expect(
      provider.restore({ projectDir: dir, id: "deadbeef" }),
    ).rejects.toThrow(/no version history yet/i);
    expect(await provider.listHistory(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot records changes and listHistory returns newest first", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nSecond draft.\n");
    const snap = await provider.snapshot({
      projectDir: dir,
      message: "Second draft",
      authorName: "Writer",
    });
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.author).toBe("Writer");

    const history = await provider.listHistory(dir);
    expect(history.length).toBe(2);
    expect(history[0]!.message).toBe("Second draft");
    expect(history[1]!.message).toBe("Initial snapshot");
    // Canonical timestamp: snapshot() must report the committed object's
    // timestamp — identical to what listHistory reads back.
    expect(snap.timestamp).toBe(history[0]!.timestamp);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot with no changes is rejected (no empty history entries)", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await expect(
      provider.snapshot({ projectDir: dir, message: "Nothing changed" }),
    ).rejects.toThrow(/no changes/i);
    expect((await provider.listHistory(dir)).length).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restore returns the working tree to the chosen snapshot", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    const first = (await provider.listHistory(dir))[0]!;
    await writeFile(path.join(dir, "chapter-01.md"), "# Rewritten\n");
    await provider.snapshot({ projectDir: dir, message: "Rewrite" });

    await provider.restore({ projectDir: dir, id: first.id });
    const content = await readFile(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toContain("First draft.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restoreVersionWithBackup snapshots dirty state before restoring", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    const first = (await provider.listHistory(dir))[0]!;

    // Unsaved-to-history edit, then restore to the first snapshot.
    await writeFile(path.join(dir, "chapter-01.md"), "# Unsaved work\n");
    const result = await restoreVersionWithBackup({
      projectDir: dir,
      id: first.id,
    });
    expect(result.restoredId).toBe(first.id);
    expect(result.backupId).toMatch(/^[0-9a-f]{40}$/);

    // The working tree is back at the first snapshot…
    const content = await readFile(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toContain("First draft.");

    // …and the pre-restore state stays reachable via the backup entry.
    const history = await provider.listHistory(dir);
    expect(history[0]!.id).toBe(result.backupId!);
    expect(history[0]!.message).toBe(RESTORE_BACKUP_MESSAGE);
    await provider.restore({ projectDir: dir, id: result.backupId! });
    const recovered = await readFile(path.join(dir, "chapter-01.md"), "utf8");
    expect(recovered).toContain("Unsaved work");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restoreVersionWithBackup skips the backup when the tree is clean", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "# Rewritten\n");
    await provider.snapshot({ projectDir: dir, message: "Rewrite" });
    const history = await provider.listHistory(dir);
    const first = history[1]!;

    const result = await restoreVersionWithBackup({ projectDir: dir, id: first.id });
    expect(result.backupId).toBeUndefined();
    expect((await provider.listHistory(dir)).length).toBe(2);
    const content = await readFile(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toContain("First draft.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restoreVersionWithBackup rejects on a plain folder", async () => {
  const dir = await tempDir();
  try {
    await expect(
      restoreVersionWithBackup({ projectDir: dir, id: "deadbeef" }),
    ).rejects.toThrow(/no version history yet/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deleting a file (fs only) is a pending change and is recorded by snapshot", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "notes.md"), "# Notes\n");
    await provider.snapshot({ projectDir: dir, message: "Add notes" });
    const preDelete = (await provider.listHistory(dir))[0]!;

    // Delete via the filesystem only — nothing staged.
    await rm(path.join(dir, "notes.md"));
    const snap = await provider.snapshot({ projectDir: dir, message: "Remove notes" });
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);

    // The deletion is part of history: restoring the pre-delete snapshot
    // brings the file back…
    await provider.restore({ projectDir: dir, id: preDelete.id });
    expect(await readFile(path.join(dir, "notes.md"), "utf8")).toContain("Notes");
    // …and restoring the post-delete snapshot removes it again.
    await provider.restore({ projectDir: dir, id: snap.id });
    await expect(stat(path.join(dir, "notes.md"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restore failure after a backup snapshot reports the backup in the error", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    // Dirty the tree so the safety snapshot is forced, then restore to an
    // id that does not exist — the restore step itself must fail.
    await writeFile(path.join(dir, "chapter-01.md"), "# Unsaved work\n");
    const bogusId = "0".repeat(40);
    let caught: unknown;
    try {
      await restoreVersionWithBackup({ projectDir: dir, id: bogusId });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error;
    // Author-facing: the work was auto-saved and lives in version history.
    expect(err.message).toMatch(/your work is safe/i);
    expect(err.message).toMatch(/backup snapshot/i);
    expect(err.message).toMatch(/version history/i);
    expect(err.cause).toBeDefined();

    // The backup commit really exists and contains the unsaved work.
    const history = await provider.listHistory(dir);
    expect(history[0]!.message).toBe(RESTORE_BACKUP_MESSAGE);
    expect(err.message).toContain(history[0]!.id.slice(0, 7));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Automatic snapshots (RC1-3) ───────────────────────────────────────────────

test("automatic snapshot records changes under AUTO_SNAPSHOT_MESSAGE", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nAuto draft.\n");
    const snap = await provider.snapshot({
      projectDir: dir,
      message: AUTO_SNAPSHOT_MESSAGE,
    });
    expect(snap.message).toBe("Automatic snapshot");
    const history = await provider.listHistory(dir);
    expect(history[0]!.message).toBe(AUTO_SNAPSHOT_MESSAGE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("automatic snapshot on a clean tree rejects with an isNoChangesError error", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    let caught: unknown;
    try {
      await provider.snapshot({ projectDir: dir, message: AUTO_SNAPSHOT_MESSAGE });
    } catch (e) {
      caught = e;
    }
    // The host scheduler fires blindly and swallows exactly this rejection.
    expect(isNoChangesError(caught)).toBe(true);
    // The guard kept history clean: no empty "Automatic snapshot" entry.
    expect((await provider.listHistory(dir)).length).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isNoChangesError is false for other errors", () => {
  expect(isNoChangesError(new Error("repository is corrupt"))).toBe(false);
  expect(isNoChangesError("no changes since the last snapshot")).toBe(false);
  expect(isNoChangesError(undefined)).toBe(false);
});

// Host-timer cadence policy (autoSnapshotDelayMs / autoSyncDelayMs /
// isGitInternalPath) moved to host-policy.ts — its behavior is locked by
// host-policy.test.ts.

// ── Nested-repo guard (defense in depth) ─────────────────────────────────────

test("initVersionHistory never git-inits inside an existing repo (hand-built source)", async () => {
  const dir = await tempDir();
  try {
    await initProject(dir); // outer repo
    const inner = path.join(dir, "nested-project");
    await mkdir(inner, { recursive: true });
    await writeFile(path.join(inner, "chapter-01.md"), "# Inner\n");

    // Classification now maps this folder to `local-git-folder` (it shares
    // the enclosing repo's history), so the UI never offers Enable here. The
    // guard remains for a stale/hand-built local-folder source: a nested
    // `git init` must never happen.
    const provider = providerFor({ type: "local-folder", path: inner });
    await expect(
      provider.initVersionHistory({ projectDir: inner }),
    ).rejects.toThrow(/already inside a versioned project/i);
    // No shadow repo was created.
    await expect(stat(gitDirFor(inner))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Book subfolders of a larger repo (scoped history) ────────────────────────

/**
 * Fixture: one enclosing repo with two book folders. Returns providers for
 * both books, each classified as `local-git-folder` with a non-empty subPath.
 */
async function initTwoBookRepo(dir: string) {
  await mkdir(path.join(dir, "book-a"), { recursive: true });
  await mkdir(path.join(dir, "book-b"), { recursive: true });
  await writeFile(path.join(dir, "README.md"), "# Books\n");
  await writeFile(path.join(dir, "book-a", "chapter-01.md"), "# A1\n\nFirst draft A.\n");
  await writeFile(path.join(dir, "book-b", "chapter-01.md"), "# B1\n\nFirst draft B.\n");
  const root = providerFor({ type: "local-folder", path: dir });
  await root.initVersionHistory({ projectDir: dir, initialMessage: "Initial snapshot" });

  const sourceA = await detectProjectSource(path.join(dir, "book-a"));
  const sourceB = await detectProjectSource(path.join(dir, "book-b"));
  expect(sourceA.type).toBe("local-git-folder");
  expect(sourceB.type).toBe("local-git-folder");
  if (sourceA.type === "local-git-folder") {
    expect(sourceA.repoRoot).toBe(dir);
    expect(sourceA.subPath).toBe("book-a");
  }
  return {
    bookA: providerFor(sourceA),
    bookB: providerFor(sourceB),
    dirA: path.join(dir, "book-a"),
    dirB: path.join(dir, "book-b"),
  };
}

test("subfolder snapshot commits the WHOLE repo (a project is its git repo)", async () => {
  const dir = await tempDir();
  try {
    const { bookA, dirA, dirB } = await initTwoBookRepo(dir);
    // Edits in BOTH books; snapshotting from book A commits the whole tree.
    await writeFile(path.join(dirA, "chapter-01.md"), "# A1\n\nSecond draft A.\n");
    await writeFile(path.join(dirB, "chapter-01.md"), "# B1\n\nSecond draft B.\n");
    const snap = await bookA.snapshot({ projectDir: dirA, message: "A second draft" });
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);

    // The committed tree contains BOTH books' new content (plain git add -A).
    const git = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");
    const a = await git.readBlob({
      fs: fsMod, dir, oid: snap.id, filepath: "book-a/chapter-01.md",
    });
    expect(Buffer.from(a.blob).toString()).toContain("Second draft A.");
    const b = await git.readBlob({
      fs: fsMod, dir, oid: snap.id, filepath: "book-b/chapter-01.md",
    });
    expect(Buffer.from(b.blob).toString()).toContain("Second draft B.");
    // Nothing left pending — the whole tree was committed in one snapshot.
    await expect(
      bookA.snapshot({ projectDir: dirA, message: "nothing new" }),
    ).rejects.toThrow(/no changes/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("subfolder listHistory shows the WHOLE repo history", async () => {
  const dir = await tempDir();
  try {
    const { bookA, bookB, dirA, dirB } = await initTwoBookRepo(dir);
    await writeFile(path.join(dirA, "chapter-01.md"), "# A1\n\nSecond draft A.\n");
    await bookA.snapshot({ projectDir: dirA, message: "A change" });
    await writeFile(path.join(dirB, "chapter-01.md"), "# B1\n\nSecond draft B.\n");
    await bookB.snapshot({ projectDir: dirB, message: "B change" });

    // A project is its git repo: both subfolders see the SAME whole-repo
    // history (newest-first), not a per-book slice.
    const whole = ["B change", "A change", "Initial snapshot"];
    expect((await bookA.listHistory(dirA)).map((e) => e.message)).toEqual(whole);
    expect((await bookB.listHistory(dirB)).map((e) => e.message)).toEqual(whole);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("subfolder restore restores the WHOLE repo; safe-restore backs up unsaved work", async () => {
  const dir = await tempDir();
  try {
    const { bookA, dirA, dirB } = await initTwoBookRepo(dir);
    const initial = (await bookA.listHistory(dirA))[0]!;
    await writeFile(path.join(dirA, "chapter-01.md"), "# A1\n\nRewritten A.\n");
    await writeFile(path.join(dirB, "chapter-01.md"), "# B1\n\nRewritten B.\n");
    await bookA.snapshot({ projectDir: dirA, message: "Rewrite both" });

    // Unsaved edits across the repo before restoring to the initial commit.
    await writeFile(path.join(dirA, "chapter-01.md"), "# A1\n\nUnsaved A.\n");
    await writeFile(path.join(dirB, "chapter-01.md"), "# B1\n\nUnsaved B.\n");
    const result = await restoreVersionWithBackup({ projectDir: dirA, id: initial.id });
    expect(result.backupId).toMatch(/^[0-9a-f]{40}$/);

    // Whole tree restored to the initial commit — BOTH books reverted.
    expect(await readFile(path.join(dirA, "chapter-01.md"), "utf8")).toContain("First draft A.");
    expect(await readFile(path.join(dirB, "chapter-01.md"), "utf8")).toContain("First draft B.");

    // Nothing is lost: the unsaved edits to BOTH books are in the backup commit.
    const git = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");
    const ua = await git.readBlob({ fs: fsMod, dir, oid: result.backupId!, filepath: "book-a/chapter-01.md" });
    const ub = await git.readBlob({ fs: fsMod, dir, oid: result.backupId!, filepath: "book-b/chapter-01.md" });
    expect(Buffer.from(ua.blob).toString()).toContain("Unsaved A.");
    expect(Buffer.from(ub.blob).toString()).toContain("Unsaved B.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent snapshot calls on the same repo serialize coherently", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "a.md"), "# A\n");
    await writeFile(path.join(dir, "b.md"), "# B\n");

    // Fire both without awaiting — the per-repo queue must serialize them.
    const results = await Promise.allSettled([
      provider.snapshot({ projectDir: dir, message: "First concurrent" }),
      provider.snapshot({ projectDir: dir, message: "Second concurrent" }),
    ]);

    // The first stages the FULL tree (both files), so the second sees a clean
    // tree and gets the friendly "no changes" rejection — never corruption.
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/no changes/i);

    // Repo is consistent: exactly one new commit, both files reachable in it.
    const history = await provider.listHistory(dir);
    expect(history.length).toBe(2);
    expect(history[0]!.message).toBe("First concurrent");
    await provider.restore({ projectDir: dir, id: history[0]!.id });
    expect(await readFile(path.join(dir, "a.md"), "utf8")).toContain("A");
    expect(await readFile(path.join(dir, "b.md"), "utf8")).toContain("B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── History paging (bounded listHistory + load-more continuation) ────────────

test("listHistoryPage pages newest-first with a before-cursor, no dups or gaps", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    for (let i = 1; i <= 7; i++) {
      // Vary the SIZE per write: consecutive same-size writes within the same
      // second are invisible to git's stat-based change detection (racy index).
      await writeFile(
        path.join(dir, "chapter-01.md"),
        `# Hello\n\nDraft ${i}.\n${"x".repeat(i)}\n`,
      );
      await provider.snapshot({ projectDir: dir, message: `Draft ${i}` });
    }
    // 8 commits total (initial + 7). Page size 3 → pages of 3 / 3 / 2.
    const p1 = await provider.listHistoryPage(dir, { limit: 3 });
    expect(p1.entries.map((e) => e.message)).toEqual(["Draft 7", "Draft 6", "Draft 5"]);
    expect(p1.hasMore).toBe(true);

    const p2 = await provider.listHistoryPage(dir, {
      limit: 3,
      before: p1.entries.at(-1)!.id,
    });
    expect(p2.entries.map((e) => e.message)).toEqual(["Draft 4", "Draft 3", "Draft 2"]);
    expect(p2.hasMore).toBe(true);

    const p3 = await provider.listHistoryPage(dir, {
      limit: 3,
      before: p2.entries.at(-1)!.id,
    });
    expect(p3.entries.map((e) => e.message)).toEqual(["Draft 1", "Initial snapshot"]);
    expect(p3.hasMore).toBe(false);

    // No overlap between pages.
    const all = [...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listHistoryPage hasMore is exact at a page boundary (limit == remaining)", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nDraft 1.\n");
    await provider.snapshot({ projectDir: dir, message: "Draft 1" });
    // Exactly 2 commits, limit 2 → one full page, hasMore false.
    const page = await provider.listHistoryPage(dir, { limit: 2 });
    expect(page.entries.length).toBe(2);
    expect(page.hasMore).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listHistoryPage tolerates a garbage/expired cursor", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    const page = await provider.listHistoryPage(dir, {
      limit: 5,
      before: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("subfolder listHistoryPage pages the WHOLE repo history", async () => {
  const dir = await tempDir();
  try {
    const { bookA, bookB, dirA, dirB } = await initTwoBookRepo(dir);
    for (let i = 1; i <= 3; i++) {
      // Size-varying writes — see the racy-index note in the paging test above.
      await writeFile(
        path.join(dirA, "chapter-01.md"),
        `# A1\n\nDraft ${i}.\n${"a".repeat(i)}\n`,
      );
      await bookA.snapshot({ projectDir: dirA, message: `A draft ${i}` });
      await writeFile(
        path.join(dirB, "chapter-01.md"),
        `# B1\n\nDraft ${i}.\n${"b".repeat(i)}\n`,
      );
      await bookB.snapshot({ projectDir: dirB, message: `B draft ${i}` });
    }
    // 7 commits total (initial + 3×A + 3×B). A subfolder pages the WHOLE repo
    // newest-first — A and B commits interleaved, not a per-book slice.
    const whole = ["B draft 3", "A draft 3", "B draft 2", "A draft 2", "B draft 1", "A draft 1", "Initial snapshot"];
    const p1 = await bookA.listHistoryPage(dirA, { limit: 4 });
    expect(p1.entries.map((e) => e.message)).toEqual(whole.slice(0, 4));
    expect(p1.hasMore).toBe(true);
    const p2 = await bookA.listHistoryPage(dirA, { limit: 4, before: p1.entries.at(-1)!.id });
    expect(p2.entries.map((e) => e.message)).toEqual(whole.slice(4));
    expect(p2.hasMore).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listHistory is a bounded page (delegates to listHistoryPage defaults)", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nDraft.\n");
    await provider.snapshot({ projectDir: dir, message: "Draft" });
    const viaList = await provider.listHistory(dir);
    const viaPage = await provider.listHistoryPage(dir);
    expect(viaList).toEqual(viaPage.entries);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Regression guard for GitHub issue #50 (silent data loss): a file rewritten
// with DIFFERENT content of the SAME byte length within the same mtime second
// must still be detected as changed. isomorphic-git's WORKDIR walker reuses the
// cached index oid when size+mtime match, so without the Phase 2 racy-index
// guard in listWorkdirChanges() (source-provider.ts) the edit is invisible and
// the snapshot silently drops it. This test pins identical mtimes via utimes()
// so the guard's content-rehash path is ALWAYS exercised (independent of how
// fast the writes happen) — it FAILS if that else-branch is removed.
test("same-byte-length edits are detected (racy index) — issue #50", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "chapter-01.md");
  try {
    const provider = await initProject(dir);
    // "aaa" = 3 bytes
    await writeFile(file, "aaa");
    await provider.snapshot({ projectDir: dir, message: "First" });
    const stagedStat = await stat(file);

    // "bbb" = 3 bytes — same length, different content.
    await writeFile(file, "bbb");
    // Force the worst case: identical size AND identical mtime/atime as the
    // staged version, so the stat fast path cannot see the change and only the
    // Phase 2 content rehash can catch it.
    await utimes(file, stagedStat.atime, stagedStat.mtime);
    const changes = await listWorkdirChanges(dir);
    expect(changes.adds).toContain("chapter-01.md");

    // snapshot succeeds and the committed content is "bbb", not "aaa"
    const snap = await provider.snapshot({ projectDir: dir, message: "Second" });
    const gitMod = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");
    const blob = await gitMod.readBlob({
      fs: fsMod,
      dir,
      oid: snap.id,
      filepath: "chapter-01.md",
    });
    expect(Buffer.from(blob.blob).toString()).toBe("bbb");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Crash-window recovery: staged-but-uncommitted edits are not lost ──────────
//
// Staging and commit are two separate writes. A crash between them leaves the
// index matching the workdir with no commit — the WORKDIR↔STAGE changes walk
// then reports "nothing to save" forever, silently hiding the edits from
// snapshot/sync/backup. The staging marker makes the state detectable and the
// next snapshot commits it.

test("a snapshot interrupted between staging and commit is recovered by the next snapshot", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    const gitMod = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");

    // Simulate the crash window: edit a file, stage it, write the marker —
    // but never commit (exactly the on-disk state a mid-snapshot crash leaves).
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nEdited draft.\n");
    await gitMod.add({ fs: fsMod, dir, filepath: "chapter-01.md" });
    fsMod.writeFileSync(path.join(gitDirFor(dir), "print-md-snapshot-staging"), "");

    // The walk sees workdir == stage: without the marker this would throw
    // "no changes" and the edit would stay invisible forever.
    const changes = await listWorkdirChanges(dir, {});
    expect(changes.adds.length + changes.removes.length).toBe(0);

    const snap = await provider.snapshot({ projectDir: dir, message: "recovered" });
    expect(snap.id).toBeDefined();

    // The edit is now IN history and the marker is gone.
    const history = await provider.listHistory(dir);
    expect(history[0]!.message).toBe("recovered");
    expect(
      fsMod.existsSync(path.join(gitDirFor(dir), "print-md-snapshot-staging")),
    ).toBe(false);
    // The committed tree contains the edited content.
    const head = await gitMod.resolveRef({ fs: fsMod, dir, ref: "HEAD" });
    const { blob } = await gitMod.readBlob({
      fs: fsMod,
      dir,
      oid: head,
      filepath: "chapter-01.md",
    });
    expect(new TextDecoder().decode(blob)).toBe("# Hello\n\nEdited draft.\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a marker left AFTER a successful commit does not create a phantom empty snapshot", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    const gitMod = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");

    // A real snapshot that completes normally.
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nEdited draft.\n");
    const snap = await provider.snapshot({ projectDir: dir, message: "Real snapshot" });
    const historyBefore = await provider.listHistory(dir);
    expect(historyBefore.length).toBe(2);

    // Simulate the OTHER crash window: the marker is written before staging
    // and removed after `git.commit()` returns — a crash between those two
    // events leaves the marker behind even though the commit above already
    // succeeded and the working tree is clean. Hand-recreate that state.
    fsMod.writeFileSync(path.join(gitDirFor(dir), "print-md-snapshot-staging"), "");
    const changes = await listWorkdirChanges(dir, {});
    expect(changes.adds.length + changes.removes.length).toBe(0);

    const recovered = await provider.snapshot({
      projectDir: dir,
      message: "should never be committed",
    });

    // No new commit was made — the returned entry IS the pre-existing HEAD,
    // not a duplicate "should never be committed" entry.
    expect(recovered.id).toBe(snap.id);
    const historyAfter = await provider.listHistory(dir);
    expect(historyAfter.map((e) => e.id)).toEqual(historyBefore.map((e) => e.id));
    expect(historyAfter.length).toBe(2);

    // The stale marker is cleared so future snapshots stop "recovering".
    expect(
      fsMod.existsSync(path.join(gitDirFor(dir), "print-md-snapshot-staging")),
    ).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the original crash-after-staging case still commits (unaffected by the phantom-snapshot guard)", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    const gitMod = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");

    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nStaged edit.\n");
    await gitMod.add({ fs: fsMod, dir, filepath: "chapter-01.md" });
    fsMod.writeFileSync(path.join(gitDirFor(dir), "print-md-snapshot-staging"), "");

    const snap = await provider.snapshot({ projectDir: dir, message: "recovered staged edit" });

    const history = await provider.listHistory(dir);
    expect(history[0]!.id).toBe(snap.id);
    expect(history[0]!.message).toBe("recovered staged edit");
    expect(history.length).toBe(2);
    expect(
      fsMod.existsSync(path.join(gitDirFor(dir), "print-md-snapshot-staging")),
    ).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a clean tree with no stale marker still reports 'no changes'", async () => {
  const dir = await tempDir();
  try {
    const provider = await initProject(dir);
    await expect(
      provider.snapshot({ projectDir: dir, message: "nothing" }),
    ).rejects.toThrow(/no changes since the last snapshot/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
