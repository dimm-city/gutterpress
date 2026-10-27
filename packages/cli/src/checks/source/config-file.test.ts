import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfigFile } from "./config-file";

// #443 — a source check's config file is found by its usual name, in the
// book's folder or a folder above it, up to the repository the book is in.
// There is no manifest setting for its path.

const NAMES = [".markdownlint.jsonc", ".markdownlint.json"] as const;
const dirs: string[] = [];

async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gutterpress-config-file-"));
  dirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("findConfigFile", () => {
  test("finds the config in the book's own folder, by the first name that exists", async () => {
    const book = await tree();
    await writeFile(join(book, ".markdownlint.json"), "{}");
    expect(findConfigFile(book, NAMES)).toBe(join(book, ".markdownlint.json"));
    await writeFile(join(book, ".markdownlint.jsonc"), "{}");
    expect(findConfigFile(book, NAMES)).toBe(join(book, ".markdownlint.jsonc"));
  });

  test("walks up to the repository root the book lives in", async () => {
    const repo = await tree();
    await mkdir(join(repo, ".git"));
    await writeFile(join(repo, ".markdownlint.jsonc"), "{}");
    const book = join(repo, "books", "book-01");
    await mkdir(book, { recursive: true });
    expect(findConfigFile(book, NAMES)).toBe(join(repo, ".markdownlint.jsonc"));
  });

  test("the nearest config wins over one further up", async () => {
    const repo = await tree();
    await mkdir(join(repo, ".git"));
    await writeFile(join(repo, ".markdownlint.jsonc"), "{}");
    const books = join(repo, "books");
    const book = join(books, "book-01");
    await mkdir(book, { recursive: true });
    await writeFile(join(books, ".markdownlint.json"), "{}");
    expect(findConfigFile(book, NAMES)).toBe(join(books, ".markdownlint.json"));
  });

  test("stops at the repository: a config above the folder holding .git is not used", async () => {
    const outside = await tree();
    await writeFile(join(outside, ".markdownlint.jsonc"), "{}");
    const repo = join(outside, "repo");
    const book = join(repo, "book");
    await mkdir(book, { recursive: true });
    // A worktree or submodule has a `.git` FILE; a plain clone a folder.
    await writeFile(join(repo, ".git"), "gitdir: elsewhere\n");
    expect(findConfigFile(book, NAMES)).toBeNull();
  });

  test("returns null when no folder up to the repository has the config", async () => {
    const repo = await tree();
    await mkdir(join(repo, ".git"));
    expect(findConfigFile(repo, NAMES)).toBeNull();
  });
});
