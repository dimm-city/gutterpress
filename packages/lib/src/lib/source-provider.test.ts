import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectProjectSource } from "./project-source";
import {
  providerFor,
  restoreVersionWithBackup,
  gitDirFor,
  RESTORE_BACKUP_MESSAGE,
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
