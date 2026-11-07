/**
 * A revision switch the app dies in the middle of (issue #502): at every step
 * the next look must leave one consistent tree, with the author's work kept.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import {
  repairInterruptedSwitch,
  restoreVersionWithBackup,
  switchBranch,
  takeSwitchRepairNotice,
  countUnversionedChanges,
  providerFor,
} from "./source-provider.ts";
import { detectProjectSource } from "./project-source.ts";

const AUTHOR = { name: "A", email: "a@example.com" };

async function commitAll(dir: string, message: string): Promise<string> {
  for (const f of await git.statusMatrix({ fs, dir })) {
    if (f[2] === 0) await git.remove({ fs, dir, filepath: f[0] });
    else await git.add({ fs, dir, filepath: f[0] });
  }
  return git.commit({ fs, dir, message, author: AUTHOR });
}

const put = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");
const journal = (dir: string) => path.join(dir, ".git", "gutterpress-switch.json");

/** main: ch1, ch2, old.css. second: ch1 changed, new/ folder, no old.css. */
async function book() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sw-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  put(dir, "ch1.md", "one");
  put(dir, "ch2.md", "two");
  put(dir, "old.css", "css");
  await commitAll(dir, "main");
  await git.branch({ fs, dir, ref: "second", checkout: true });
  put(dir, "ch1.md", "ONE second");
  put(dir, "new/a.md", "a");
  put(dir, "new/deep/b.md", "b");
  fs.rmSync(path.join(dir, "old.css"));
  await commitAll(dir, "second");
  await git.checkout({ fs, dir, ref: "main" });
  fs.rmSync(path.join(dir, "new"), { recursive: true, force: true }); // checkout leaves empty folders
  return dir;
}

/** What the crashed checkout left: index/tree partly moved, HEAD still on main. */
function halfSwitched(dir: string) {
  fs.rmSync(path.join(dir, "old.css"), { force: true });
  put(dir, "ch1.md", "ONE second");
  put(dir, "new/a.md", "a"); // untracked leftovers
  fs.mkdirSync(path.join(dir, "new/deep"), { recursive: true });
}

async function expectMainClean(dir: string) {
  expect(read(dir, "ch1.md")).toBe("one");
  expect(read(dir, "old.css")).toBe("css");
  expect(fs.existsSync(path.join(dir, "new"))).toBe(false);
  expect(await git.currentBranch({ fs, dir })).toBe("main");
  expect(await git.statusMatrix({ fs, dir }).then((m) => m.filter((r) => r[1] !== 1 || r[2] !== 1 || r[3] !== 1))).toEqual([]);
  expect(fs.existsSync(journal(dir))).toBe(false);
}

describe("a switch interrupted at each step", () => {
  test("a clean switch leaves no journal", async () => {
    const dir = await book();
    await switchBranch({ projectDir: dir, branch: "second" });
    expect(await git.currentBranch({ fs, dir })).toBe("second");
    expect(fs.existsSync(journal(dir))).toBe(false);
  });

  test("the journal is on disk before the checkout and names both versions", async () => {
    const dir = await book();
    put(dir, "ch2.md", "two edited");
    let seen: Record<string, unknown> | undefined;
    const real = git.checkout;
    // Crash point: observe the journal at the moment the checkout begins.
    (git as { checkout: unknown }).checkout = async (o: never) => {
      seen = JSON.parse(fs.readFileSync(journal(dir), "utf8"));
      return real(o);
    };
    try {
      await switchBranch({ projectDir: dir, branch: "second" });
    } finally {
      (git as { checkout: unknown }).checkout = real;
    }
    expect(seen).toMatchObject({ kind: "switch", branch: "second", fromBranch: "main" });
    expect(seen!.from).not.toBe(seen!.to);
  });

  test("checkout throws before touching anything: the book is as it was and the work is kept", async () => {
    const dir = await book();
    put(dir, "ch2.md", "two edited");
    put(dir, "notes/untracked.md", "mine");
    await failingCheckout(() => {}, () =>
      expect(switchBranch({ projectDir: dir, branch: "second" })).rejects.toThrow("disk full"),
    );
    expect(read(dir, "ch2.md")).toBe("two edited");
    expect(read(dir, "notes/untracked.md")).toBe("mine");
    expect(fs.existsSync(journal(dir))).toBe(false);
    expect(await git.currentBranch({ fs, dir })).toBe("main");
  });

  test("checkout throws mid-way: rolled back to the saved version, work and untracked files kept", async () => {
    const dir = await book();
    put(dir, "ch2.md", "two edited");
    put(dir, "notes/untracked.md", "mine");
    await failingCheckout(() => halfSwitched(dir), () =>
      expect(switchBranch({ projectDir: dir, branch: "second" })).rejects.toThrow("disk full"),
    );
    expect(read(dir, "ch2.md")).toBe("two edited");
    expect(read(dir, "notes/untracked.md")).toBe("mine");
    expect(read(dir, "old.css")).toBe("css");
    expect(read(dir, "ch1.md")).toBe("one");
    expect(fs.existsSync(path.join(dir, "new"))).toBe(false);
    expect(fs.existsSync(journal(dir))).toBe(false);
    expect(await git.currentBranch({ fs, dir })).toBe("main");
  });

  test("killed mid-checkout (journal left): opening the book rolls back, keeps the work, says so once", async () => {
    const dir = await book();
    put(dir, "ch2.md", "two edited");
    put(dir, "notes/untracked.md", "mine");
    // A kill ends the process before any cleanup: the checkout hangs forever
    // here and the test inspects the disk as the next launch would find it.
    const real = git.checkout;
    let released: () => void = () => {};
    let hung = false;
    (git as { checkout: unknown }).checkout = (o: never) => {
      if (hung) return real(o); // the repair's own checkout
      hung = true;
      return new Promise<void>((resolve) => {
        halfSwitched(dir);
        released = resolve;
      });
    };
    const running = switchBranch({ projectDir: dir, branch: "second" });
    while (!fs.existsSync(path.join(dir, "new/a.md"))) await new Promise((r) => setTimeout(r, 5));
    expect(fs.existsSync(journal(dir))).toBe(true);
    // The "new launch": repair directly (the held lock belongs to the dead process).
    const { repairInterruptedSwitchUnlocked } = await import("./source-provider.ts");
    expect(await repairInterruptedSwitchUnlocked(dir)).toContain("put back");
    (git as { checkout: unknown }).checkout = real;
    released();
    await running.catch(() => {});
    expect(read(dir, "ch2.md")).toBe("two edited");
    expect(read(dir, "notes/untracked.md")).toBe("mine");
    expect(read(dir, "old.css")).toBe("css");
    expect(read(dir, "ch1.md")).toBe("one");
    expect(fs.existsSync(path.join(dir, "new"))).toBe(false);
    expect(await takeSwitchRepairNotice(dir)).toContain("put back");
    expect(await takeSwitchRepairNotice(dir)).toBeNull();
  });
});

/** Make the next git.checkout run `during()` then throw, around `body`. */
async function failingCheckout(during: () => void, body: () => unknown) {
  const real = git.checkout;
  let first = true;
  (git as { checkout: unknown }).checkout = async (o: never) => {
    if (first) {
      first = false;
      during();
      throw new Error("disk full");
    }
    return real(o);
  };
  try {
    await body();
  } finally {
    (git as { checkout: unknown }).checkout = real;
  }
}

/** A journal as the app leaves it, without running a switch. */
async function crashedState(dir: string, over: Record<string, unknown> = {}) {
  const from = await git.resolveRef({ fs, dir, ref: "refs/heads/main" });
  const to = await git.resolveRef({ fs, dir, ref: "refs/heads/second" });
  fs.writeFileSync(journal(dir), JSON.stringify({ kind: "switch", from, fromBranch: "main", to, branch: "second", ...over }));
}

describe("repairInterruptedSwitch", () => {
  test("half-switched tree is restored: staged deletions, modified files, untracked folders", async () => {
    const dir = await book();
    await crashedState(dir);
    halfSwitched(dir);
    await git.remove({ fs, dir, filepath: "old.css" }); // the deletion was staged
    expect(await repairInterruptedSwitch(dir)).toContain("put back");
    await expectMainClean(dir);
  });

  test("killed before cleanup, HEAD already moved: the finished switch is kept", async () => {
    const dir = await book();
    await git.checkout({ fs, dir, ref: "second" });
    await crashedState(dir);
    expect(await repairInterruptedSwitch(dir)).toContain("nothing needed fixing");
    expect(await git.currentBranch({ fs, dir })).toBe("second");
    expect(read(dir, "ch1.md")).toBe("ONE second");
    expect(fs.existsSync(journal(dir))).toBe(false);
  });

  test("killed right after the journal, nothing touched: a no-op rollback", async () => {
    const dir = await book();
    await crashedState(dir);
    await repairInterruptedSwitch(dir);
    await expectMainClean(dir);
  });

  test("a snapshot never saves a half-switched tree as a version", async () => {
    const dir = await book();
    await crashedState(dir);
    halfSwitched(dir);
    const before = await git.resolveRef({ fs, dir, ref: "HEAD" });
    const provider = providerFor(await detectProjectSource(dir));
    await provider.snapshot({ projectDir: dir, message: "auto" }).catch(() => {});
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(before);
    await expectMainClean(dir);
  });

  test("an unreadable journal on a clean tree rolls back to HEAD and says it could not be read", async () => {
    const dir = await book();
    fs.writeFileSync(journal(dir), "{not json");
    expect(await repairInterruptedSwitch(dir)).toContain("could not be read");
    expect(fs.existsSync(journal(dir))).toBe(false);
  });

  test("no journal means nothing happens", async () => {
    const dir = await book();
    expect(await repairInterruptedSwitch(dir)).toBeNull();
  });
});

describe("a failed restore", () => {
  test("a checkout that throws part-way is rolled back and the safety version holds the work", async () => {
    const dir = await book();
    const target = await git.resolveRef({ fs, dir, ref: "refs/heads/second" });
    put(dir, "ch2.md", "two edited");
    await failingCheckout(() => put(dir, "ch1.md", "torn"), () =>
      expect(restoreVersionWithBackup({ projectDir: dir, id: target })).rejects.toThrow("your work is safe"),
    );
    expect(read(dir, "ch1.md")).toBe("one");
    expect(read(dir, "ch2.md")).toBe("two edited");
    expect(fs.existsSync(journal(dir))).toBe(false);
  });
});

/** The files of the side ref a repair kept, by path. */
async function keptCopy(dir: string): Promise<{ ref: string; read: (f: string) => Promise<string> }> {
  const refs = await git.listRefs({ fs, dir, filepath: "refs/gutterpress" });
  expect(refs.length).toBe(1);
  const ref = `refs/gutterpress/${refs[0]}`;
  const oid = await git.resolveRef({ fs, dir, ref });
  return {
    ref,
    read: async (f) => new TextDecoder().decode((await git.readBlob({ fs, dir, oid, filepath: f })).blob),
  };
}

describe("a repair never loses what was written after the journal", () => {
  test("edits made after the crash, before the repair, are kept on a side ref and named", async () => {
    const dir = await book();
    await crashedState(dir);
    halfSwitched(dir);
    put(dir, "ch2.md", "typed after relaunch");
    put(dir, "notes/new.md", "new file");
    const message = await repairInterruptedSwitch(dir);
    const kept = await keptCopy(dir);
    expect(await kept.read("ch2.md")).toBe("typed after relaunch");
    expect(await kept.read("notes/new.md")).toBe("new file");
    expect(message).toContain(kept.ref);
    expect(read(dir, "ch2.md")).toBe("two"); // the tree is the saved version
  });

  test("a snapshot after a crash cannot swallow an edit: it is on the side ref", async () => {
    const dir = await book();
    await crashedState(dir);
    halfSwitched(dir);
    put(dir, "ch2.md", "typed after relaunch");
    const provider = providerFor(await detectProjectSource(dir));
    await provider.snapshot({ projectDir: dir, message: "auto" }).catch(() => {});
    expect(await (await keptCopy(dir)).read("ch2.md")).toBe("typed after relaunch");
  });

  test("an edit made during the checkout, which then fails, is kept", async () => {
    const dir = await book();
    await failingCheckout(() => put(dir, "ch2.md", "typed during switch"), () =>
      expect(switchBranch({ projectDir: dir, branch: "second" })).rejects.toThrow("disk full"),
    );
    expect(await (await keptCopy(dir)).read("ch2.md")).toBe("typed during switch");
  });

  test("no side ref is made when the tree already equals the saved version", async () => {
    const dir = await book();
    await crashedState(dir);
    await repairInterruptedSwitch(dir);
    expect(await git.listRefs({ fs, dir, filepath: "refs/gutterpress" })).toEqual([]);
  });
});

describe("the sweep deletes only what the half-done move wrote", () => {
  test("an author's ignored file at a target-only path is kept and listed", async () => {
    const dir = await book();
    put(dir, ".gitignore", "new/\n");
    await commitAll(dir, "ignore new");
    put(dir, "new/a.md", "MY OWN NOTES");
    await crashedState(dir, { startedAt: Date.now() + 60_000 }); // the file is older than the move
    const message = await repairInterruptedSwitch(dir);
    expect(read(dir, "new/a.md")).toBe("MY OWN NOTES");
    expect(message).toContain("new/a.md");
  });

  test("a file the move wrote (same bytes as the target) is removed", async () => {
    const dir = await book();
    await crashedState(dir, { startedAt: Date.now() + 60_000 });
    halfSwitched(dir);
    await repairInterruptedSwitch(dir);
    expect(fs.existsSync(path.join(dir, "new"))).toBe(false);
  });

  test("the author's own empty folders survive, only folders the move made go", async () => {
    const dir = await book();
    fs.mkdirSync(path.join(dir, "new/deep"), { recursive: true });
    await crashedState(dir, { preexistingDirs: ["new", "new/deep"] });
    await repairInterruptedSwitch(dir);
    expect(fs.existsSync(path.join(dir, "new/deep"))).toBe(true);
  });

  test("a folder at a target-only path does not wedge the repair or later saves", async () => {
    const dir = await book();
    put(dir, "new/a.md/inside.md", "a folder named like the target's file");
    await crashedState(dir, { preexistingDirs: ["new", "new/a.md"] });
    const message = await repairInterruptedSwitch(dir);
    expect(message).toContain("new/a.md");
    expect(read(dir, "new/a.md/inside.md")).toContain("folder named");
    const provider = providerFor(await detectProjectSource(dir));
    await provider.snapshot({ projectDir: dir, message: "later" });
    expect(fs.existsSync(journal(dir))).toBe(false);
  });
});

describe("an unreadable journal", () => {
  test("on a dirty tree keeps the author's edits on a side ref and rolls back to HEAD", async () => {
    const dir = await book();
    fs.writeFileSync(journal(dir), "{not json");
    put(dir, "ch2.md", "unsaved edit");
    put(dir, "notes/untracked.md", "mine");
    const message = await repairInterruptedSwitch(dir);
    const kept = await keptCopy(dir);
    expect(await kept.read("ch2.md")).toBe("unsaved edit");
    expect(await kept.read("notes/untracked.md")).toBe("mine");
    expect(read(dir, "notes/untracked.md")).toBe("mine");
    expect(message).toContain(kept.ref);
    expect(fs.existsSync(journal(dir))).toBe(false);
  });
});

describe("messages", () => {
  test("an interrupted restore says restoring a version was interrupted", async () => {
    const dir = await book();
    await crashedState(dir, { kind: "restore", branch: undefined });
    expect(await repairInterruptedSwitch(dir)).toContain("Restoring a version was interrupted");
  });

  test("an interrupted switch says switching revisions was interrupted", async () => {
    const dir = await book();
    await crashedState(dir);
    expect(await repairInterruptedSwitch(dir)).toContain("Switching revisions was interrupted");
  });
});
