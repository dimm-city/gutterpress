import { test, expect } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveRepairRepoDir } from "./repair";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pmd-repair-"));
}

async function makeGitDir(dir: string, branch: string): Promise<void> {
  const gitDir = path.join(dir, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
  await writeFile(path.join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");
}

test("repair resolves the opened repo itself, not an enclosing parent repo", async () => {
  const root = await tempDir();
  try {
    const outer = path.join(root, "outer");
    const inner = path.join(outer, "book");
    await mkdir(inner, { recursive: true });
    await makeGitDir(outer, "outer-main");
    await makeGitDir(inner, "inner-main");

    await expect(resolveRepairRepoDir(inner)).resolves.toBe(inner);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repair resolves a project subfolder to its owning repo root", async () => {
  const root = await tempDir();
  try {
    const repo = path.join(root, "repo");
    const book = path.join(repo, "books", "field-guide");
    await mkdir(book, { recursive: true });
    await makeGitDir(repo, "main");

    await expect(resolveRepairRepoDir(book)).resolves.toBe(repo);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
