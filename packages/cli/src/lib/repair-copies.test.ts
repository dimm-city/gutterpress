/**
 * #507 builds refuse while a switch is unresolved; #508 repair copies are
 * pruned, listed, restorable and discardable, and never leave the computer.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { runBuild } from "./build-runner.ts";
import {
  BEFORE_REPAIR_REF_PREFIX,
  REPAIR_COPY_KEEP,
  discardRepairCopy,
  listRepairCopies,
  listRevisions,
  restoreRepairCopy,
  unfinishedSwitchMessage,
} from "./source-provider.ts";

const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

async function book() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rc-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  fs.writeFileSync(path.join(dir, "ch1.md"), "one");
  await git.add({ fs, dir, filepath: "ch1.md" });
  await git.commit({ fs, dir, message: "v1", author: { name: "A", email: "a@x.io", timestamp: nowSec() - 100 * DAY } });
  return dir;
}

/** A repair copy commit with a chosen time, holding `text` as ch1.md. */
async function makeCopy(dir: string, id: string, ageDays: number, text = "kept"): Promise<void> {
  const parent = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const blob = await git.writeBlob({ fs, dir, blob: Buffer.from(text) });
  const tree = await git.writeTree({ fs, dir, tree: [{ mode: "100644", path: "ch1.md", oid: blob, type: "blob" }] });
  const who = { name: "A", email: "a@x.io", timestamp: nowSec() - ageDays * DAY };
  const oid = await git.commit({ fs, dir, tree, parent: [parent], message: "copy", author: who, committer: who, noUpdateBranch: true });
  await git.writeRef({ fs, dir, ref: `${BEFORE_REPAIR_REF_PREFIX}${id}`, value: oid, force: true });
}

async function saveVersion(dir: string, ageDays = 0): Promise<void> {
  fs.writeFileSync(path.join(dir, "ch1.md"), `v${Math.random()}`);
  await git.add({ fs, dir, filepath: "ch1.md" });
  await git.commit({ fs, dir, message: "later", author: { name: "A", email: "a@x.io", timestamp: nowSec() - ageDays * DAY } });
}

const ids = async (dir: string) => (await listRepairCopies(dir)).map((c) => c.id);

describe("#507 builds refuse while a switch is unresolved", () => {
  test("no journal: no message; journal: plain message naming the saved copy", async () => {
    const dir = await book();
    expect(await unfinishedSwitchMessage(dir)).toBeNull();
    await makeCopy(dir, "20261107000000001", 0);
    fs.writeFileSync(path.join(dir, ".git", "gutterpress-switch.json"), "{}");
    const msg = (await unfinishedSwitchMessage(dir))!;
    expect(msg).toContain("part-way through switching revisions");
    expect(msg).toContain("Book setup");
    expect(msg).toContain(`${BEFORE_REPAIR_REF_PREFIX}20261107000000001`);
  });

  test("runBuild (the CLI and desktop path) rejects before doing any work", async () => {
    const dir = await book();
    fs.writeFileSync(path.join(dir, ".git", "gutterpress-switch.json"), "{}");
    await expect(runBuild({ inputDir: dir, format: "html" } as never)).rejects.toThrow(/part-way through switching revisions/);
  });
});

describe("#508 repair copy lifecycle", () => {
  test("a copy newer than the last saved version is never pruned, however many there are", async () => {
    const dir = await book();
    for (let i = 0; i < REPAIR_COPY_KEEP + 3; i++) await makeCopy(dir, `2026110700000000${i}`, 0);
    await saveVersion(dir, 1); // last saved version is a day old: every copy is newer
    expect((await ids(dir)).length).toBe(REPAIR_COPY_KEEP + 3);
  });

  test("once a newer version is saved, only the newest few stay", async () => {
    const dir = await book();
    for (let i = 0; i < REPAIR_COPY_KEEP + 3; i++) await makeCopy(dir, `2026110700000000${i}`, 10 - i);
    await saveVersion(dir, 0);
    const kept = await ids(dir);
    expect(kept.length).toBe(REPAIR_COPY_KEEP);
    expect(kept[0]).toBe("20261107000000007"); // the youngest of the eight
  });

  test("an old copy past the age limit goes after a newer save, a young one stays", async () => {
    const dir = await book();
    await makeCopy(dir, "20260101000000000", 60);
    await makeCopy(dir, "20261101000000000", 2);
    await saveVersion(dir, 0);
    expect(await ids(dir)).toEqual(["20261101000000000"]);
  });

  test("listRevisions carries the copies; revisions list ignores refs/gutterpress", async () => {
    const dir = await book();
    await makeCopy(dir, "20261107000000001", 0);
    const list = (await listRevisions(dir))!;
    expect(list.repairCopies.map((c) => c.id)).toEqual(["20261107000000001"]);
    expect(list.revisions.map((r) => r.name)).toEqual(["main"]);
    expect(await git.listBranches({ fs, dir })).toEqual(["main"]);
  });

  test("restore puts the copy's files back, saving unsaved work first; discard removes it", async () => {
    const dir = await book();
    await makeCopy(dir, "20261107000000001", 0, "from the copy");
    fs.writeFileSync(path.join(dir, "ch1.md"), "unsaved edit");
    const r = await restoreRepairCopy({ projectDir: dir, id: "20261107000000001" });
    expect(fs.readFileSync(path.join(dir, "ch1.md"), "utf8")).toBe("from the copy");
    expect(r.backupId).toBeTruthy(); // the unsaved edit is a version now
    expect(await ids(dir)).toEqual(["20261107000000001"]);
    await discardRepairCopy(dir, "20261107000000001");
    expect(await ids(dir)).toEqual([]);
  });

  test("an unknown or malformed id is refused", async () => {
    const dir = await book();
    await expect(restoreRepairCopy({ projectDir: dir, id: "../heads/main" })).rejects.toThrow(/no longer there/);
    await expect(discardRepairCopy(dir, "20269999999999999")).rejects.toThrow(/no longer there/);
  });
});
