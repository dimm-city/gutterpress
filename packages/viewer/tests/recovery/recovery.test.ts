import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  recoveryFileName,
  upsertEntry,
  removeEntry,
  readIndex,
  writeRecovery,
  clearRecovery,
  listRecovery,
  readRecoveryContent,
  type RecoveryEntry,
} from "../../electron/recovery";

let recDir: string;
let projDir: string;

beforeEach(async () => {
  recDir = await mkdtemp(path.join(tmpdir(), "pmd-rec-"));
  projDir = await mkdtemp(path.join(tmpdir(), "pmd-proj-"));
});

afterEach(async () => {
  await rm(recDir, { recursive: true, force: true });
  await rm(projDir, { recursive: true, force: true });
});

test("recoveryFileName is deterministic and 16 hex chars + .md", () => {
  const a = recoveryFileName("/x/y.md");
  expect(a).toBe(recoveryFileName("/x/y.md"));
  expect(a).not.toBe(recoveryFileName("/x/z.md"));
  expect(a).toMatch(/^[0-9a-f]{16}\.md$/);
});

test("upsertEntry replaces by filePath (newest first); removeEntry drops it", () => {
  const e1: RecoveryEntry = { filePath: "/a", recoveryPath: "/r/a", savedAt: 1, baseMtimeMs: 0 };
  const e2: RecoveryEntry = { filePath: "/b", recoveryPath: "/r/b", savedAt: 2, baseMtimeMs: 0 };
  let idx = upsertEntry([], e1);
  idx = upsertEntry(idx, e2);
  expect(idx.map((e) => e.filePath)).toEqual(["/b", "/a"]);
  // Re-upsert /a with new savedAt → moves to front, no duplicate.
  idx = upsertEntry(idx, { ...e1, savedAt: 9 });
  expect(idx.map((e) => e.filePath)).toEqual(["/a", "/b"]);
  expect(idx.length).toBe(2);
  idx = removeEntry(idx, "/a");
  expect(idx.map((e) => e.filePath)).toEqual(["/b"]);
});

test("readIndex returns [] for absent or corrupt index", async () => {
  expect(await readIndex(recDir)).toEqual([]);
  await mkdir(recDir, { recursive: true });
  await writeFile(path.join(recDir, "index.json"), "not json", "utf-8");
  expect(await readIndex(recDir)).toEqual([]);
});

test("writeRecovery persists snapshot + index; readRecoveryContent reads it back", async () => {
  const file = path.join(projDir, "ch.md");
  await writeFile(file, "on disk", "utf-8");
  const res = await writeRecovery(recDir, file, "in memory", 42);
  expect(res.ok).toBe(true);

  const idx = await readIndex(recDir);
  expect(idx.length).toBe(1);
  expect(idx[0]!.filePath).toBe(file);
  expect(idx[0]!.baseMtimeMs).toBe(42);
  expect(await readRecoveryContent(idx[0]!.recoveryPath)).toBe("in memory");
});

test("clearRecovery removes the entry and the snapshot file, never the real file", async () => {
  const file = path.join(projDir, "ch.md");
  await writeFile(file, "on disk", "utf-8");
  await writeRecovery(recDir, file, "in memory", 1);
  const before = await readIndex(recDir);
  const snapPath = before[0]!.recoveryPath;

  const res = await clearRecovery(recDir, file);
  expect(res.ok).toBe(true);
  expect(await readIndex(recDir)).toEqual([]);
  await expect(stat(snapPath)).rejects.toBeDefined();
  // The author's real file is untouched.
  expect(await readFile(file, "utf-8")).toBe("on disk");
});

test("listRecovery returns only this project's live snapshots, newest first", async () => {
  const fileA = path.join(projDir, "a.md");
  const fileB = path.join(projDir, "b.md");
  const otherDir = await mkdtemp(path.join(tmpdir(), "pmd-other-"));
  const fileC = path.join(otherDir, "c.md");
  await writeFile(fileA, "x", "utf-8");
  await writeFile(fileB, "y", "utf-8");
  await writeFile(fileC, "z", "utf-8");
  // Snapshots are taken against the live disk mtime (the baseline), as the
  // editor does — so listRecovery never treats the on-disk file as superseded.
  const mtA = (await stat(fileA)).mtimeMs;
  const mtB = (await stat(fileB)).mtimeMs;
  const mtC = (await stat(fileC)).mtimeMs;

  await writeRecovery(recDir, fileA, "AA", mtA);
  await new Promise((r) => setTimeout(r, 25));
  await writeRecovery(recDir, fileB, "BB", mtB);
  await writeRecovery(recDir, fileC, "CC", mtC);

  const list = await listRecovery(recDir, projDir);
  // Only A and B belong to projDir; newest (B) first.
  expect(list.map((e) => e.filePath)).toEqual([fileB, fileA]);
  await rm(otherDir, { recursive: true, force: true });
});

test("listRecovery skips entries the user has saved past (disk newer than snapshot)", async () => {
  const file = path.join(projDir, "a.md");
  await writeFile(file, "orig", "utf-8");
  const baseMtime = (await stat(file)).mtimeMs;
  await writeRecovery(recDir, file, "AA", baseMtime);
  // Another process saves the file after the snapshot baseline → disk mtime
  // moves past baseMtimeMs, so the recovery is superseded and not offered.
  await new Promise((r) => setTimeout(r, 30));
  await writeFile(file, "saved past the snapshot", "utf-8");

  const list = await listRecovery(recDir, projDir);
  expect(list).toEqual([]);
});

test("listRecovery prunes superseded entries so stale prompts do not return next launch", async () => {
  const file = path.join(projDir, "stale.md");
  await writeFile(file, "orig", "utf-8");
  const baseMtime = (await stat(file)).mtimeMs;
  await writeRecovery(recDir, file, "unsaved sidecar", baseMtime);

  await new Promise((r) => setTimeout(r, 30));
  await writeFile(file, "saved on disk", "utf-8");

  expect(await listRecovery(recDir, projDir)).toEqual([]);
  expect(await readIndex(recDir)).toEqual([]);
});

test("listRecovery prunes entries whose snapshot already matches disk", async () => {
  const file = path.join(projDir, "saved.md");
  await writeFile(file, "already saved", "utf-8");
  const savedMtime = (await stat(file)).mtimeMs;
  await writeRecovery(recDir, file, "already saved", savedMtime);

  expect(await listRecovery(recDir, projDir)).toEqual([]);
  expect(await readIndex(recDir)).toEqual([]);
});
