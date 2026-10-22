/**
 * version-changes.ts over a real (temporary) repository built with
 * isomorphic-git: what each version changed, whether it is backed up,
 * which commits an online tip has that the local tip lacks, the aligned
 * compare rows, and a version's files written out for the preview.
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
  listVersionChanges,
} from "./version-changes";

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
    expect(described[1]!.changes.map((c) => c.path)).toContain("chapter-01.md");
    expect(described[0]!.changes).toEqual([{ path: "notes.md", kind: "removed", hint: "removed", text: true }]);
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
});

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
