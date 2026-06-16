/**
 * Tests for inspect.ts — inspectRepo returns the correct RepoHealth snapshot.
 *
 * Uses REAL on-disk temp repos (isomorphic-git, node:fs). No mocks.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import git from "isomorphic-git";

import { inspectRepo } from "./inspect.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "inspect-test-"));
}

async function makeCleanRepo(dir: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "readme.md"), "# Test\n");
  await git.add({ fs, dir, filepath: "readme.md" });
  const author = { name: "Test", email: "test@test.local" };
  await git.commit({ fs, dir, message: "initial", author });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("inspectRepo — missing .git dir", () => {
  test("hasGitDir=false when no .git exists", async () => {
    const dir = await makeTempDir();
    // Do NOT init — just a plain directory.
    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasGitDir).toBe(false);
    expect(health.isDetachedHead).toBe(false);
    expect(health.hasStaleLock).toBe(false);
    expect(health.hasInterruptedMerge).toBe(false);
    expect(health.hasInterruptedRebase).toBe(false);
    expect(health.hasInterruptedCherryPick).toBe(false);
    expect(health.hasLocalChanges).toBe(false);
  });
});

describe("inspectRepo — clean healthy repo", () => {
  test("hasGitDir=true, all flags false", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasGitDir).toBe(true);
    expect(health.isDetachedHead).toBe(false);
    expect(health.currentBranch).toBe("main");
    expect(health.hasStaleLock).toBe(false);
    expect(health.hasInterruptedMerge).toBe(false);
    expect(health.hasInterruptedRebase).toBe(false);
    expect(health.hasInterruptedCherryPick).toBe(false);
  });

  test("hasLocalChanges=false when working tree is clean", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasLocalChanges).toBe(false);
  });

  test("hasLocalChanges=true when there are untracked files", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    // Add an untracked file.
    await writeFile(path.join(dir, "new-chapter.md"), "# New\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasLocalChanges).toBe(true);
  });
});

describe("inspectRepo — detached HEAD", () => {
  test("isDetachedHead=true when HEAD is detached", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    // Detach HEAD by writing a raw SHA to it.
    const sha = await git.resolveRef({ fs, dir, ref: "main" });
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), sha + "\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.isDetachedHead).toBe(true);
    expect(health.currentBranch).toBeUndefined();
  });
});

describe("inspectRepo — stale lock", () => {
  test("hasStaleLock=true when .git/index.lock exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    // Simulate a stale lock.
    const lockPath = path.join(dir, ".git", "index.lock");
    fs.writeFileSync(lockPath, "");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(true);
  });

  test("lockAgeMs is defined when lock exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    const lockPath = path.join(dir, ".git", "index.lock");
    fs.writeFileSync(lockPath, "");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.lockAgeMs).toBeDefined();
    expect(typeof health.lockAgeMs).toBe("number");
  });

  test("hasStaleLock=false when no lock file", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(false);
    expect(health.lockAgeMs).toBeUndefined();
  });
});

describe("inspectRepo — interrupted operations", () => {
  test("hasInterruptedMerge=true when MERGE_HEAD exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const sha = await git.resolveRef({ fs, dir, ref: "main" });
    fs.writeFileSync(path.join(dir, ".git", "MERGE_HEAD"), sha + "\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasInterruptedMerge).toBe(true);
  });

  test("hasInterruptedCherryPick=true when CHERRY_PICK_HEAD exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const sha = await git.resolveRef({ fs, dir, ref: "main" });
    fs.writeFileSync(path.join(dir, ".git", "CHERRY_PICK_HEAD"), sha + "\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasInterruptedCherryPick).toBe(true);
  });

  test("hasInterruptedRebase=true when rebase-merge dir exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    fs.mkdirSync(path.join(dir, ".git", "rebase-merge"), { recursive: true });

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasInterruptedRebase).toBe(true);
  });

  test("hasInterruptedRebase=true when rebase-apply dir exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    fs.mkdirSync(path.join(dir, ".git", "rebase-apply"), { recursive: true });

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasInterruptedRebase).toBe(true);
  });
});

describe("inspectRepo — never throws", () => {
  test("does not throw on an empty directory", async () => {
    const dir = await makeTempDir();
    // Completely empty dir — no .git, no files.
    await expect(inspectRepo({ repoDir: dir })).resolves.toBeDefined();
  });

  test("does not throw when given a nonexistent dir", async () => {
    await expect(
      inspectRepo({ repoDir: "/tmp/absolutely-does-not-exist-abc123" }),
    ).resolves.toBeDefined();
  });
});
