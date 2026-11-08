/**
 * #507 builds refuse while a switch is unresolved; #508 repair copies are
 * pruned only when saved, listed, restorable and discardable.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import { runBuild } from "./build-runner.ts";
import {
  BEFORE_REPAIR_REF_PREFIX,
  REPAIR_COPY_KEEP,
  countUnversionedChanges,
  discardRepairCopy,
  keepUnfinishedSwitchAsIs,
  listRepairCopies,
  listRevisions,
  providerFor,
  repairInterruptedSwitch,
  restoreRepairCopy,
  switchBranch,
  unfinishedSwitchMessage,
  unfinishedSwitchState,
} from "./source-provider.ts";
import { detectProjectSource } from "./project-source.ts";

const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);
const AUTHOR = { name: "A", email: "a@x.io" };
const journal = (dir: string) => path.join(dir, ".git", "gutterpress-switch.json");
const put = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

async function commitAll(dir: string, message: string, timestamp = nowSec()): Promise<string> {
  for (const f of await git.statusMatrix({ fs, dir })) {
    if (f[2] === 0) await git.remove({ fs, dir, filepath: f[0] });
    else await git.add({ fs, dir, filepath: f[0] });
  }
  return git.commit({ fs, dir, message, author: { ...AUTHOR, timestamp } });
}

/** main: manifest, ch1, ch2. second: ch1 changed, a new folder. Open on main. */
async function book() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rc-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  put(dir, "manifest.yaml", "title: T\n");
  put(dir, "ch1.md", "# one\n");
  put(dir, "ch2.md", "# two\n");
  await commitAll(dir, "main", nowSec() - 100 * DAY);
  await git.branch({ fs, dir, ref: "second", checkout: true });
  put(dir, "ch1.md", "# ONE second\n");
  put(dir, "new/a.md", "a");
  await commitAll(dir, "second", nowSec() - 99 * DAY);
  await git.checkout({ fs, dir, ref: "main" });
  fs.rmSync(path.join(dir, "new"), { recursive: true, force: true });
  return dir;
}

/** A crashed switch main -> second, the author's edit written after it, then a real repair. Returns the copy id. */
async function repairedWithEdit(dir: string, edit = "# typed after relaunch\n"): Promise<string> {
  const from = await git.resolveRef({ fs, dir, ref: "refs/heads/main" });
  const to = await git.resolveRef({ fs, dir, ref: "refs/heads/second" });
  fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from, fromBranch: "main", to, branch: "second" }));
  put(dir, "ch1.md", "# ONE second\n"); // the move's work
  put(dir, "new/a.md", "a");
  put(dir, "ch2.md", edit); // the author's
  await repairInterruptedSwitch(dir);
  const [id] = (await listRepairCopies(dir)).map((c) => c.id);
  expect(id).toBeTruthy();
  return id!;
}

/** A bare repair copy with chosen time and one changed file. */
async function makeCopy(dir: string, id: string, ageDays: number, file = "ch2.md", text = "kept"): Promise<void> {
  const parent = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const blob = await git.writeBlob({ fs, dir, blob: Buffer.from(text) });
  const tree = await git.writeTree({ fs, dir, tree: [{ mode: "100644", path: file, oid: blob, type: "blob" }] });
  const who = { ...AUTHOR, timestamp: nowSec() - ageDays * DAY };
  const oid = await git.commit({ fs, dir, tree, parent: [parent], message: "copy", author: who, committer: who, noUpdateBranch: true });
  await git.writeRef({ fs, dir, ref: `${BEFORE_REPAIR_REF_PREFIX}${id}`, value: oid, force: true });
}

const ids = async (dir: string) => (await listRepairCopies(dir)).map((c) => c.id);
const snapshot = async (dir: string, message = "later") =>
  providerFor(await detectProjectSource(dir)).snapshot({ projectDir: dir, message });

describe("#507 builds refuse while a switch is unresolved", () => {
  test("no journal: nothing; journal: plain message, no git words, naming only this switch's own copy for the CLI", async () => {
    const dir = await book();
    expect(await unfinishedSwitchMessage(dir)).toBeNull();
    await makeCopy(dir, "20261107000000001", 5); // an older, resolved repair's copy
    await makeCopy(dir, "20261107000000002", 0);
    fs.writeFileSync(journal(dir), "{}");
    const app = (await unfinishedSwitchMessage(dir))!;
    expect(app).toContain("part-way through switching revisions");
    expect(app).toContain("Book setup");
    expect(app).not.toContain("refs/");
    expect((await unfinishedSwitchState(dir))!.copy).toBeUndefined(); // an unreadable journal names no copy
    const from = await git.resolveRef({ fs, dir, ref: "HEAD" });
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from, to: from, keptCopy: `${BEFORE_REPAIR_REF_PREFIX}20261107000000002` }));
    const cli = (await unfinishedSwitchMessage(dir, { cli: true }))!;
    expect(cli).toContain("20261107000000002");
    expect(cli).not.toContain("20261107000000001");
    expect((await unfinishedSwitchMessage(dir))!).not.toContain("refs/");
  });

  test("the unfinished-switch wording is a wire contract: the desktop matches /part-way through switching/ (errors.ts friendlyPdfError)", async () => {
    const dir = await book();
    const bad = "0".repeat(40);
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from: bad, to: bad, fromBranch: "main" }));
    const msg = (await unfinishedSwitchMessage(dir, { cli: true }))!;
    expect(msg).toMatch(/part-way through switching/);
    expect((await unfinishedSwitchMessage(dir))!).toMatch(/part-way through switching/);
  });

  test("runBuild on a real book: refuses with an unresolved switch; only the desktop export repairs, then builds", async () => {
    const dir = await book();
    put(dir, "chapter-01.md", "# Hello\n");
    await commitAll(dir, "chapter");
    const bad = "0".repeat(40);
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from: bad, to: bad, fromBranch: "main" }));
    await expect(runBuild({ inputDir: dir, format: "html", rawArgs: {} } as never)).rejects.toThrow(/part-way through switching revisions/);
    expect(fs.existsSync(journal(dir))).toBe(true);
    // The desktop export refuses too when its repair cannot finish.
    await expect(runBuild({ inputDir: dir, format: "html", rawArgs: {}, engineBrowser: (async () => ({})) as never } as never)).rejects.toThrow(/part-way/);
    // An unreadable record on a clean tree is rolled back to HEAD by the repair, then the build runs.
    // An unreadable record on a clean tree: a plain command-line run never repairs, it refuses naming the copy hint...
    fs.writeFileSync(journal(dir), "{");
    await expect(runBuild({ inputDir: dir, format: "html", rawArgs: {} } as never)).rejects.toThrow(/part-way through switching revisions/);
    expect(fs.existsSync(journal(dir))).toBe(true);
    // ...while the desktop export (it injects its own browser) repairs first, in its own process, then builds.
    const out = fs.mkdtempSync(path.join(process.env.HOME ?? "/tmp", "rc-out-"));
    try {
      const r = await runBuild({ inputDir: dir, format: "html", outDir: out, rawArgs: {}, engineBrowser: (async () => ({})) as never } as never);
      expect(r.htmlPath).toBe(path.join(out, "book.html"));
      expect(fs.existsSync(journal(dir))).toBe(false);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test("keep files as they are: a copy is kept once, the journal goes, saving works again", async () => {
    const dir = await book();
    const from = await git.resolveRef({ fs, dir, ref: "refs/heads/main" });
    const to = await git.resolveRef({ fs, dir, ref: "refs/heads/second" });
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from, fromBranch: "main", to, branch: "second" }));
    put(dir, "ch2.md", "# edited\n");
    await keepUnfinishedSwitchAsIs(dir);
    expect(fs.existsSync(journal(dir))).toBe(false);
    expect(await ids(dir)).toHaveLength(1);
    expect(read(dir, "ch2.md")).toBe("# edited\n");
    await snapshot(dir, "after keeping");
    expect(await unfinishedSwitchState(dir)).toBeNull();
  });
});

describe("#508 repair copy lifecycle", () => {
  test("a copy whose files are in no version is never pruned, however many and however old", async () => {
    const dir = await book();
    for (let i = 0; i < REPAIR_COPY_KEEP + 3; i++) await makeCopy(dir, `2026010100000000${i}`, 90 + i, "ch2.md", `unsaved ${i}`);
    put(dir, "ch1.md", "# a later save\n");
    await snapshot(dir); // the real prune hook runs after this
    expect((await ids(dir)).length).toBe(REPAIR_COPY_KEEP + 3);
    expect((await listRepairCopies(dir)).every((c) => !c.saved)).toBe(true);
  });

  test("copies already in history are pruned past the count and age limits by the snapshot hook; listing prunes nothing", async () => {
    const dir = await book();
    for (let i = 0; i < REPAIR_COPY_KEEP + 3; i++) await makeCopy(dir, `2026110700000000${i}`, 10 - i); // all hold ch2.md = "kept"
    await makeCopy(dir, "20260101000000000", 60);
    put(dir, "ch2.md", "kept");
    await snapshot(dir); // "kept" is now a version: every copy is saved, the hook prunes
    const left = await ids(dir);
    expect(left.length).toBe(REPAIR_COPY_KEEP);
    expect(left).not.toContain("20260101000000000");
    expect((await listRepairCopies(dir)).every((c) => c.saved)).toBe(true);
    // Reading does not prune.
    await makeCopy(dir, "20261107999999999", 40);
    await listRevisions(dir);
    expect(await ids(dir)).toContain("20261107999999999");
  });

  test("listRevisions carries the copies with their draft; the revision list ignores refs/gutterpress", async () => {
    const dir = await book();
    const id = await repairedWithEdit(dir);
    const list = (await listRevisions(dir))!;
    expect(list.repairCopies).toEqual([{ id, savedAt: expect.any(Number), saved: false, revision: "main" }]);
    expect(list.revisions.map((r) => r.name).sort()).toEqual(["main", "second"]);
    expect(await git.listBranches({ fs, dir })).toEqual(["main", "second"]);
  });

  test("real repair, restore, discard, switch away and back: the edit survives and the other revision's files do not come back", async () => {
    const dir = await book();
    const id = await repairedWithEdit(dir);
    expect(read(dir, "ch2.md")).toBe("# two\n"); // repaired to the saved version
    const r = await restoreRepairCopy({ projectDir: dir, id });
    expect(r.files).toBe(1);
    expect(read(dir, "ch2.md")).toBe("# typed after relaunch\n");
    expect(read(dir, "ch1.md")).toBe("# one\n"); // the move's ch1 stays out
    expect(fs.existsSync(path.join(dir, "new"))).toBe(false);
    // The restore is a version, so the index agrees with the files and there is nothing left to save.
    const log = await git.log({ fs, dir, depth: 1 });
    expect(log[0]!.commit.message).toContain("Restored files from a saved copy");
    expect((await countUnversionedChanges(dir))?.changedFiles ?? 0).toBe(0);
    expect((await listRepairCopies(dir))[0]!.saved).toBe(true);
    await discardRepairCopy(dir, id);
    expect(await ids(dir)).toEqual([]);
    await switchBranch({ projectDir: dir, branch: "second" });
    expect(read(dir, "ch2.md")).toBe("# two\n");
    await switchBranch({ projectDir: dir, branch: "main" });
    expect(read(dir, "ch2.md")).toBe("# typed after relaunch\n");
  });

  test("restore keeps an executable file executable", async () => {
    const dir = await book();
    const from = await git.resolveRef({ fs, dir, ref: "refs/heads/main" });
    const to = await git.resolveRef({ fs, dir, ref: "refs/heads/second" });
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from, fromBranch: "main", to, branch: "second" }));
    put(dir, "tool.sh", "#!/bin/sh\n");
    fs.chmodSync(path.join(dir, "tool.sh"), 0o755);
    await repairInterruptedSwitch(dir);
    const [id] = await ids(dir);
    fs.rmSync(path.join(dir, "tool.sh"), { force: true });
    await restoreRepairCopy({ projectDir: dir, id: id! });
    expect(fs.statSync(path.join(dir, "tool.sh")).mode & 0o111).not.toBe(0);
  });

  test("restore saves work not yet in a version first, and an unresolved journal is settled or refused, never overwritten", async () => {
    const dir = await book();
    const id = await repairedWithEdit(dir);
    put(dir, "ch1.md", "# unsaved edit\n");
    const r = await restoreRepairCopy({ projectDir: dir, id });
    expect(r.backupId).toBeTruthy();
    // A journal that cannot be settled blocks the restore.
    const bad = "0".repeat(40);
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from: bad, to: bad }));
    await expect(restoreRepairCopy({ projectDir: dir, id })).rejects.toThrow(/part-way through switching revisions/);
    expect(JSON.parse(fs.readFileSync(journal(dir), "utf8")).from).toBe(bad);
  });

  test("discard refuses a copy whose files are saved nowhere, unless told they may be lost; unknown ids are refused", async () => {
    const dir = await book();
    const id = await repairedWithEdit(dir);
    await expect(discardRepairCopy(dir, id)).rejects.toThrow(/aren't saved anywhere else/);
    expect(await ids(dir)).toEqual([id]);
    await discardRepairCopy(dir, id, { unsaved: true });
    expect(await ids(dir)).toEqual([]);
    await expect(restoreRepairCopy({ projectDir: dir, id: "../heads/main" })).rejects.toThrow(/no longer there/);
    await expect(discardRepairCopy(dir, "20269999999999999")).rejects.toThrow(/no longer there/);
  });

  test("a retry of the same failing repair keeps one copy", async () => {
    const dir = await book();
    const from = await git.resolveRef({ fs, dir, ref: "refs/heads/main" });
    const to = await git.resolveRef({ fs, dir, ref: "refs/heads/second" });
    fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from, fromBranch: "main", to, branch: "second" }));
    put(dir, "ch2.md", "# edited\n");
    const real = git.checkout;
    (git as { checkout: unknown }).checkout = async () => {
      throw new Error("disk full");
    };
    try {
      await expect(repairInterruptedSwitch(dir)).rejects.toThrow("disk full");
      await expect(repairInterruptedSwitch(dir)).rejects.toThrow("disk full");
    } finally {
      (git as { checkout: unknown }).checkout = real;
    }
    expect(await ids(dir)).toHaveLength(1);
    expect((await unfinishedSwitchState(dir))!.copy).toBe((await ids(dir))[0]!);
  });
});
