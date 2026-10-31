/**
 * version-changes.ts over a real (temporary) repository built with
 * isomorphic-git: what a version changed, whether each is backed up,
 * which commits an online tip has that the local tip lacks, what is in the
 * online copy (over the in-process git server) and what each of those
 * versions changed, the aligned compare rows, and a version's files written
 * out for the preview.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import {
  changeHint,
  commitsAhead,
  compareVersionFile,
  describeVersions,
  exportVersionTree,
  listOnlineVersions,
  listVersionChanges,
  VERSION_CHANGES_SHOWN,
} from "./version-changes";
import { serverCommit, setupClone } from "./remote-auth/test-support/sync-harness";

const author = { name: "Test Writer", email: "writer@example.test" };
let dir: string;
let c1: string;
let c2: string;
let c3: string;
let online1: string;
let online2: string;

async function write(rel: string, content: string | Uint8Array): Promise<void> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

async function commit(files: string[], message: string): Promise<string> {
  await git.add({ fs, dir, filepath: files });
  return git.commit({ fs, dir, message, author });
}

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9]);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gutterpress-versions-"));
  await git.init({ fs, dir, defaultBranch: "main" });
  await write("manifest.yaml", "title: Test\n");
  await write("chapter-01.md", "# One\n\nFirst paragraph.\n\nSecond paragraph.\n");
  await write("styles/book.css", "h1 { color: red; }\n\np { margin: 0; }\n");
  await write("art/cover.png", PNG_A);
  c1 = await commit(["manifest.yaml", "chapter-01.md", "styles/book.css", "art/cover.png"], "Book created");

  await write("chapter-01.md", "# One\n\nFirst paragraph.\n\nSecond paragraph, reworded.\n");
  await write("styles/book.css", "h1 { color: blue; }\n\np { margin: 0; }\n");
  await write("art/cover.png", PNG_B);
  await write("notes.md", "# Notes\n");
  c2 = await commit(["chapter-01.md", "styles/book.css", "art/cover.png", "notes.md"], "Version saved by you");

  await git.remove({ fs, dir, filepath: "notes.md" });
  await rm(path.join(dir, "notes.md"));
  c3 = await git.commit({ fs, dir, message: "Automatic snapshot", author });

  // An "online" branch that moved on from c2 without c3: two commits ahead.
  await git.branch({ fs, dir, ref: "online", object: c2 });
  await git.checkout({ fs, dir, ref: "online" });
  await write("chapter-02.md", "# Two\n\nAdded online.\n");
  online1 = await commit(["chapter-02.md"], "Online version one");
  await write("chapter-02.md", "# Two\n\nAdded online.\n\nAnd more.\n");
  online2 = await commit(["chapter-02.md"], "Online version two");
  await git.checkout({ fs, dir, ref: "main" });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("changeHint", () => {
  test("prose counts paragraphs, stylesheets count rules, other text counts lines", () => {
    expect(changeHint("a.md", "p1\n\np2\n\np3\n", "p1\n\nP2\n\np3\n\np4\n")).toBe("2 paragraphs changed");
    expect(changeHint("a.md", "p1\n\np2\n", "p1\n\nP2\n")).toBe("1 paragraph changed");
    expect(changeHint("s.css", "h1 { color: red; }\np { margin: 0; }\n", "h1 { color: blue; }\np { margin: 0; }\n")).toBe("1 rule changed");
    expect(changeHint("m.yaml", "a: 1\nb: 2\n", "a: 1\nb: 3\nc: 4\n")).toBe("2 lines changed");
  });

  test("only spacing moved: 'changed' with no count", () => {
    expect(changeHint("a.md", "p1\n\np2\n", "p1\n\n\np2\n")).toBe("changed");
  });
});

describe("listVersionChanges", () => {
  test("names every file a version changed with a plain hint, sorted by path", async () => {
    const { files, more } = await listVersionChanges(dir, c2);
    expect(more).toBe(0);
    expect(files).toEqual([
      { path: "art/cover.png", kind: "changed", hint: "replaced", text: false },
      { path: "chapter-01.md", kind: "changed", hint: "1 paragraph changed", text: true },
      { path: "notes.md", kind: "added", hint: "added", text: true },
      { path: "styles/book.css", kind: "changed", hint: "1 rule changed", text: true },
    ]);
  });

  test("the first version adds everything; a removal is reported as removed", async () => {
    const first = await listVersionChanges(dir, c1);
    expect(first.files.map((f) => [f.path, f.hint])).toEqual([
      ["art/cover.png", "added"],
      ["chapter-01.md", "added"],
      ["manifest.yaml", "added"],
      ["styles/book.css", "added"],
    ]);
    expect(first.files.find((f) => f.path === "art/cover.png")!.text).toBe(false);
    const third = await listVersionChanges(dir, c3);
    expect(third.files).toEqual([{ path: "notes.md", kind: "removed", hint: "removed", text: true }]);
  });
});

describe("describeVersions", () => {
  const entries = () => [
    { id: c3, message: "Automatic snapshot", timestamp: 3 },
    { id: c2, message: "Version saved by you", timestamp: 2 },
    { id: c1, message: "Book created", timestamp: 1 },
  ];

  test("without an online copy nothing is backed up or not: null", async () => {
    const described = await describeVersions(dir, entries());
    expect(described.map((e) => e.backedUp)).toEqual([null, null, null]);
    expect(described[1]).toEqual({ id: c2, message: "Version saved by you", timestamp: 2, backedUp: null });
  });

  test("with the online copy at c2, c3 is on this computer only and the rest are backed up", async () => {
    await git.addRemote({ fs, dir, remote: "origin", url: "https://example.test/book.git" });
    await git.writeRef({ fs, dir, ref: "refs/remotes/origin/main", value: c2, force: true });
    try {
      const described = await describeVersions(dir, entries());
      expect(described.map((e) => e.backedUp)).toEqual([false, true, true]);
    } finally {
      await git.deleteRef({ fs, dir, ref: "refs/remotes/origin/main" });
      await git.deleteRemote({ fs, dir, remote: "origin" });
    }
  });

  test("answers what git.isDescendent answers, wherever the online copy is", async () => {
    await git.addRemote({ fs, dir, remote: "origin", url: "https://example.test/book.git" });
    try {
      for (const tip of [c1, c2, c3, online1, online2]) {
        await git.writeRef({ fs, dir, ref: "refs/remotes/origin/main", value: tip, force: true });
        const expected = await Promise.all(
          entries().map((e) => (e.id === tip ? true : git.isDescendent({ fs, dir, oid: tip, ancestor: e.id }))),
        );
        const described = await describeVersions(dir, entries());
        expect(described.map((e) => e.backedUp)).toEqual(expected);
      }
    } finally {
      await git.deleteRef({ fs, dir, ref: "refs/remotes/origin/main" });
      await git.deleteRemote({ fs, dir, remote: "origin" });
    }
  });
});

/** Writes versions straight into `repo`'s history, dated as asked, and notes each one's parents and date. */
function versionWriter(repo: string) {
  const parentsOf = new Map<string, string[]>();
  const dateOf = new Map<string, number>();
  let tree: string | undefined;
  const version = async (message: string, parent: string[], timestamp: number): Promise<string> => {
    tree ??= await git.writeTree({
      fs,
      dir: repo,
      tree: [
        {
          mode: "100644",
          path: "chapter-01.md",
          oid: await git.writeBlob({ fs, dir: repo, blob: new TextEncoder().encode("# One\n") }),
          type: "blob",
        },
      ],
    });
    const who = { ...author, timestamp, timezoneOffset: 0 };
    const id = await git.writeCommit({
      fs,
      dir: repo,
      commit: { message: `${message}\n\nDraft ${parentsOf.size}\n`, tree, parent, author: who, committer: who },
    });
    parentsOf.set(id, parent);
    dateOf.set(id, timestamp);
    return id;
  };
  return { version, parentsOf, dateOf };
}

const COMBINED = "Combined your changes with the online copy's";

/**
 * A book's history as two copies make it (#477): this computer's versions
 * and the online copy's, each moving on and Syncing with the other. Seeded,
 * so every run builds the same history. The collaborator's clock runs up to
 * ten minutes behind, so their version can be dated before the versions it
 * builds on, and they sometimes write on a side line combined later; this
 * computer's clock runs up to a minute behind. Some Syncs cross: each copy
 * combines the other's tip before seeing the other's (a criss-cross merge).
 * Returns both tips after each step.
 */
async function writeTwoCopies(repo: string, steps: number) {
  let seed = 477;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  await git.init({ fs, dir: repo, defaultBranch: "main" });
  const writer = versionWriter(repo);
  const { version } = writer;
  let now = 1_790_000_000;
  let local = await version("First version", [], now);
  let online = local;
  const tips: Array<{ online: string; local: string }> = [];
  for (let step = 0; step < steps; step++) {
    now += random() < 0.3 ? 0 : 1 + Math.floor(random() * 300);
    const action = random();
    if (action < 0.3) {
      local = await version("Automatic version", [local], now - Math.floor(random() * 60));
    } else if (action < 0.55) {
      online = await version("Collaborator's version", [online], now - Math.floor(random() * 600));
    } else if (action < 0.7) {
      let side = online;
      for (let i = 1 + Math.floor(random() * 3); i > 0; i--) {
        side = await version("Collaborator's version", [side], now - Math.floor(random() * 600));
      }
      online = await version("Collaborator's version", [online], now);
      online = await version(COMBINED, [online, side], now);
    } else if (local === online) {
      continue;
    } else if (action < 0.88) {
      local = await version(COMBINED, [local, online], now);
      online = local;
    } else {
      [local, online] = [await version(COMBINED, [local, online], now), await version(COMBINED, [online, local], now)];
    }
    tips.push({ online, local });
  }
  return { ...writer, tips };
}

describe("commitsAhead", () => {
  test("lists the online branch's commits above the merge base, newest first, and none when level", async () => {
    const ahead = await commitsAhead(dir, online2, c3);
    expect(ahead.map((e) => [e.id, e.message])).toEqual([
      [online2, "Online version two"],
      [online1, "Online version one"],
    ]);
    expect(await commitsAhead(dir, c3, c3)).toEqual([]);
    // The local tip is ahead of the online one: nothing to get.
    expect(await commitsAhead(dir, c2, c3)).toEqual([]);
  });

  test("lists every version only one copy has, once, newest first, after merges (#477)", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "gutterpress-versions-ahead-"));
    try {
      const { tips, parentsOf, dateOf } = await writeTwoCopies(repo, 60);
      const reach = (oid: string): Set<string> => {
        const seen = new Set<string>();
        const stack = [oid];
        for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
          if (seen.has(next)) continue;
          seen.add(next);
          stack.push(...parentsOf.get(next)!);
        }
        return seen;
      };
      // Version history's order: isomorphic-git's log (the newest commit time
      // first, a stable sort), each version once.
      const historyOrder = (tip: string): string[] => {
        const queued = new Set([tip]);
        const queue = [tip];
        const order: string[] = [];
        for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
          order.push(next);
          for (const p of parentsOf.get(next)!.filter((p) => !queued.has(p))) {
            queued.add(p);
            queue.push(p);
          }
          queue.sort((a, b) => dateOf.get(a)! - dateOf.get(b)!);
        }
        return order;
      };
      const first = [...parentsOf].find(([, parent]) => parent.length === 0)![0];
      for (const tip of new Set([tips.at(-1)!.online, tips.at(-1)!.local])) {
        const logged = (await git.log({ fs, dir: repo, ref: tip })).map((c) => c.oid);
        expect(historyOrder(tip)).toEqual([...new Set(logged)]);
        // Far ahead, through many merges, the log repeats versions within the
        // limit: the limit counts versions, not the repeats.
        expect(new Set(logged.slice(0, 20)).size).toBeLessThan(20);
        const ahead = await commitsAhead(repo, tip, first, {}, 20);
        expect(ahead.map((e) => e.id)).toEqual(historyOrder(tip).slice(0, 20));
      }

      const covered = { datedBeforeBase: 0, crissCross: 0, overLimit: 0 };
      for (const [from, base] of tips.flatMap((t) => [[t.online, t.local], [t.local, t.online]] as const)) {
        const local = reach(base);
        const expected = historyOrder(from).filter((oid) => !local.has(oid));
        // Every version only `from` has, once, newest first; none `base` has.
        expect((await commitsAhead(repo, from, base)).map((e) => e.id)).toEqual(expected);
        if (expected.length > 5) {
          // The limit counts versions, not the log's repeats.
          expect((await commitsAhead(repo, from, base, {}, 5)).map((e) => e.id)).toEqual(expected.slice(0, 5));
          covered.overLimit++;
        }
        // The merge bases: versions both have that a version only `from` has
        // builds on, and that no other of them has.
        const shared = new Set(expected.flatMap((oid) => parentsOf.get(oid)!).filter((oid) => local.has(oid)));
        const bases = [...shared].filter((b) => [...shared].every((o) => o === b || !reach(o).has(b)));
        if (expected.some((oid) => bases.some((b) => dateOf.get(oid)! < dateOf.get(b)!))) covered.datedBeforeBase++;
        if (bases.length > 1) covered.crissCross++;
      }
      // The history has what makes the walk hard, many times over.
      expect(covered.datedBeforeBase).toBeGreaterThan(5);
      expect(covered.crissCross).toBeGreaterThan(5);
      expect(covered.overLimit).toBeGreaterThan(5);

      // Two copies that share no history: another book's online copy.
      const other = await versionWriter(repo).version("Another book", [], 1_790_000_000);
      expect(await commitsAhead(repo, other, tips.at(-1)!.local)).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("a version this computer has only through a version dated before it is not listed (#477)", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "gutterpress-versions-ahead-"));
    try {
      await git.init({ fs, dir: repo, defaultBranch: "main" });
      const { version } = versionWriter(repo);
      const t = 1_790_000_000;
      const first = await version("First version", [], t);
      const collaborator = await version("Collaborator's version", [first], t + 100);
      // The writer's other computer, its clock five minutes behind, builds on
      // the collaborator's version and backs up.
      const other = await version("Automatic version", [collaborator], t + 100 + 20 - 300);
      // This computer, moved on from the first version, combines that backup.
      const mine = await version("Automatic version", [first], t + 50);
      const local = await version(COMBINED, [mine, other], t + 200);
      // The collaborator, moved on from their version, combines this computer's backup.
      const theirs = await version("Collaborator's version", [collaborator], t + 150);
      const online = await version(COMBINED, [theirs, local], t + 250);
      expect((await commitsAhead(repo, online, local)).map((e) => e.id)).toEqual([online, theirs]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("listOnlineVersions", () => {
  test("lists each version online and not here, newest first, with the files it changed (#484)", async () => {
    const h = await setupClone();
    try {
      expect(await listOnlineVersions({ projectDir: h.projectDir })).toEqual({ entries: [] });
      const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`notes-${i}.md`, `Note ${i}\n`]));
      const notes = await serverCommit(h.serverDir, ten, "Automatic version");
      const reworded = await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nThird draft.\n\nA new paragraph.\n", "notes-0.md": null },
        "Tightened chapter one",
      );
      const { entries, reason } = await listOnlineVersions({ projectDir: h.projectDir });
      expect(reason).toBeUndefined();
      expect(entries.map((e) => [e.id, e.message, e.author, e.backedUp])).toEqual([
        [reworded, "Tightened chapter one", "Server", true],
        [notes, "Automatic version", "Server", true],
      ]);
      expect(entries[0]!.changes).toEqual([
        { path: "chapter-01.md", kind: "changed", hint: "2 paragraphs changed", text: true },
        { path: "notes-0.md", kind: "removed", hint: "removed", text: true },
      ]);
      expect(entries[0]!.moreChanges).toBe(0);
      // Capped as a card lists them: the first eight by path, "and 2 more".
      expect(entries[1]!.changes.map((c) => [c.path, c.hint])).toEqual(
        Array.from({ length: VERSION_CHANGES_SHOWN }, (_, i) => [`notes-${i}.md`, "added"]),
      );
      expect(entries[1]!.moreChanges).toBe(10 - VERSION_CHANGES_SHOWN);
      // The same answer the version-changes route gives for each one.
      for (const entry of entries) {
        expect(await listVersionChanges(h.projectDir, entry.id)).toEqual({ files: entry.changes, more: entry.moreChanges });
      }
    } finally {
      await h.cleanup();
    }
  });

  test("an online copy it can't reach lists nothing and says why", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-02.md": "# Two\n" }, "Added chapter two");
      await h.server.close();
      expect(await listOnlineVersions({ projectDir: h.projectDir })).toEqual({ entries: [], reason: "offline" });
    } finally {
      await h.cleanup().catch(() => {});
    }
  });
});

describe("compareVersionFile", () => {
  test("aligns the version's text with the file as it is now and marks changed lines", async () => {
    const result = await compareVersionFile(dir, c1, "chapter-01.md");
    expect(result.binary).toBe(false);
    if (result.binary) return;
    expect(result.rows).toEqual([
      { then: "# One", now: "# One", changed: false },
      { then: "", now: "", changed: false },
      { then: "First paragraph.", now: "First paragraph.", changed: false },
      { then: "", now: "", changed: false },
      { then: "Second paragraph.", now: "Second paragraph, reworded.", changed: true },
    ]);
  });

  test("a file the version had and the folder no longer has: an empty Now column", async () => {
    const result = await compareVersionFile(dir, c2, "notes.md");
    expect(result).toEqual({ binary: false, rows: [{ then: "# Notes", now: null, changed: true }] });
  });

  test("a picture is binary; a path outside the book is refused", async () => {
    expect(await compareVersionFile(dir, c1, "art/cover.png")).toEqual({ binary: true });
    await expect(compareVersionFile(dir, c1, "../etc/passwd")).rejects.toThrow("inside the book");
    await expect(compareVersionFile(dir, c1, "/etc/passwd")).rejects.toThrow("inside the book");
  });
});

describe("exportVersionTree", () => {
  test("writes every file of the version and points at the book's folder", async () => {
    const dest = await mkdtemp(path.join(tmpdir(), "gutterpress-version-export-"));
    try {
      const { inputDir } = await exportVersionTree(dir, c2, dest);
      expect(inputDir).toBe(dest);
      expect(await readFile(path.join(dest, "chapter-01.md"), "utf8")).toContain("reworded");
      expect(await readFile(path.join(dest, "notes.md"), "utf8")).toBe("# Notes\n");
      expect(new Uint8Array(await readFile(path.join(dest, "art/cover.png")))).toEqual(PNG_B);
      expect(await readFile(path.join(dest, "styles/book.css"), "utf8")).toContain("blue");
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });
});
