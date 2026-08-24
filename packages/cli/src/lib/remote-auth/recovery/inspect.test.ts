/**
 * Tests for inspect.ts — inspectRepo returns the correct RepoHealth snapshot.
 *
 * Uses REAL on-disk temp repos (isomorphic-git, node:fs). No mocks.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir as freshTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";

import { inspectRepo } from "./inspect.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return freshTempDir("inspect-test-");
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
    expect(health.interruptedOperation).toBeUndefined();
    expect(health.hasLocalChanges).toBe(false);
  });
});

describe("inspectRepo — present-but-corrupt .git (HEAD missing/garbage)", () => {
  // A repo whose `.git/` exists but whose HEAD is MISSING or unreadable is a
  // DAMAGED repo, not a brand-new folder. hasGitDir MUST stay true so the
  // classifier routes to a repair-the-existing-repo path. If hasGitDir went
  // false here, classifyGitError returns `missing_git_dir`, whose handler
  // CLONES and talks about "setting up a remote" — the wrong fix for a repo
  // that already exists and only lost its HEAD.
  test("hasGitDir=true when .git exists but HEAD is missing", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    // Simulate a lost HEAD (interrupted write / truncated checkout).
    fs.rmSync(path.join(dir, ".git", "HEAD"));

    const health = await inspectRepo({ repoDir: dir });

    // The repo EXISTS — it is damaged, not absent.
    expect(health.hasGitDir).toBe(true);
  });

  test("hasGitDir=true when .git exists but HEAD is garbage", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "not a valid head at all\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasGitDir).toBe(true);
  });

  test("does not throw when HEAD is missing", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.rmSync(path.join(dir, ".git", "HEAD"));

    await expect(inspectRepo({ repoDir: dir })).resolves.toBeDefined();
  });

  // M1: git.currentBranch() THROWING (missing/corrupt HEAD) must be recorded
  // as headUnreadable, NOT isDetachedHead — a clean detached HEAD is when
  // currentBranch() resolves to null/undefined without throwing. Conflating
  // the two routed repo corruption into the detached-head repair (which
  // force-checks-out a branch — the wrong fix when HEAD can't be trusted).
  test("headUnreadable=true (not isDetachedHead) when HEAD is missing", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.rmSync(path.join(dir, ".git", "HEAD"));

    const health = await inspectRepo({ repoDir: dir });

    expect(health.headUnreadable).toBe(true);
    expect(health.isDetachedHead).toBe(false);
  });

  test("headUnreadable=true (not isDetachedHead) when HEAD is garbage", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "not a valid head at all\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.headUnreadable).toBe(true);
    expect(health.isDetachedHead).toBe(false);
  });
});

describe("inspectRepo — pre-classified ctx.source is reused (#87)", () => {
  test("resolves the git root from ctx.source without re-classifying repoDir", async () => {
    const repoRoot = await makeTempDir();
    await makeCleanRepo(repoRoot);
    // A repoDir that classification would call a plain folder: if inspectRepo
    // re-classified instead of honoring ctx.source, it would look for .git
    // here and report hasGitDir=false.
    const elsewhere = await makeTempDir();

    const health = await inspectRepo({
      repoDir: elsewhere,
      source: {
        type: "local-git-folder",
        path: repoRoot,
        repoRoot,
        subPath: "",
        hasRemote: false,
      },
    });

    expect(health.hasGitDir).toBe(true);
    expect(health.currentBranch).toBe("main");
  });

  test("source=null (classification failed at context build) still classifies here", async () => {
    const root = await makeTempDir();
    await makeCleanRepo(root);
    const sub = path.join(root, "book");
    fs.mkdirSync(sub, { recursive: true });

    const health = await inspectRepo({ repoDir: sub });

    expect(health.hasGitDir).toBe(true);
  });
});

describe("inspectRepo — opened at a SUBFOLDER of the repo (regression)", () => {
  // A project is often opened at a subfolder of its git repo ("opening a
  // subfolder syncs the whole repo"). inspectRepo MUST resolve the real git
  // root, not check the raw opened dir for `.git` — otherwise every such
  // project false-positives missing_git_dir and runs the destructive
  // missing-history recovery (which OOMs zipping a large `.git`).
  test("hasGitDir=true when the opened dir is a subfolder of the repo", async () => {
    const root = await makeTempDir();
    await makeCleanRepo(root);
    const sub = path.join(root, "book", "chapters");
    fs.mkdirSync(sub, { recursive: true });
    await writeFile(path.join(sub, "01.md"), "# One\n");

    const health = await inspectRepo({ repoDir: sub });

    expect(health.hasGitDir).toBe(true);
    expect(health.isDetachedHead).toBe(false);
    expect(health.currentBranch).toBe("main");
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
    expect(health.interruptedOperation).toBeUndefined();
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

  // A crash does NOT only leave index.lock — git can also leave HEAD.lock,
  // config.lock, packed-refs.lock, or a per-ref lock (refs/**/*.lock). The
  // stale-lock recovery handler scans ALL of these, so preflight health MUST
  // detect them too — otherwise a stuck HEAD.lock / ref lock leaves the repo
  // unusable forever because the handler is never triggered.
  test("hasStaleLock=true when only .git/HEAD.lock exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.writeFileSync(path.join(dir, ".git", "HEAD.lock"), "");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(true);
    expect(health.lockAgeMs).toBeDefined();
    expect(typeof health.lockAgeMs).toBe("number");
  });

  test("hasStaleLock=true when only .git/config.lock exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.writeFileSync(path.join(dir, ".git", "config.lock"), "");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(true);
  });

  test("hasStaleLock=true when only .git/packed-refs.lock exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    fs.writeFileSync(path.join(dir, ".git", "packed-refs.lock"), "");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(true);
  });

  test("hasStaleLock=true when a per-ref lock (refs/heads/main.lock) exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    const refLock = path.join(dir, ".git", "refs", "heads", "main.lock");
    fs.mkdirSync(path.dirname(refLock), { recursive: true });
    fs.writeFileSync(refLock, "");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(true);
    expect(health.lockAgeMs).toBeDefined();
  });

  test("lockAgeMs reflects the YOUNGEST lock when several exist", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);
    const gitDir = path.join(dir, ".git");
    const indexLock = path.join(gitDir, "index.lock");
    const headLock = path.join(gitDir, "HEAD.lock");
    fs.writeFileSync(indexLock, "");
    fs.writeFileSync(headLock, "");
    // Backdate index.lock so HEAD.lock is the youngest; lockAgeMs should track
    // the youngest (smallest age) — matching the handler's "if ANY lock is
    // fresh, wait" rule, where the youngest decides whether to back off.
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    fs.utimesSync(indexLock, old, old);

    const health = await inspectRepo({ repoDir: dir });

    expect(health.hasStaleLock).toBe(true);
    expect(health.lockAgeMs).toBeDefined();
    // Youngest (HEAD.lock, just written) → small age, far below the 1h backdate.
    expect(health.lockAgeMs!).toBeLessThan(60 * 60 * 1000);
  });
});

describe("inspectRepo — interrupted operations", () => {
  test("interruptedOperation=merge when MERGE_HEAD exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const sha = await git.resolveRef({ fs, dir, ref: "main" });
    fs.writeFileSync(path.join(dir, ".git", "MERGE_HEAD"), sha + "\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.interruptedOperation).toBe("merge");
  });

  test("interruptedOperation=cherry-pick when CHERRY_PICK_HEAD exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    const sha = await git.resolveRef({ fs, dir, ref: "main" });
    fs.writeFileSync(path.join(dir, ".git", "CHERRY_PICK_HEAD"), sha + "\n");

    const health = await inspectRepo({ repoDir: dir });

    expect(health.interruptedOperation).toBe("cherry-pick");
  });

  test("interruptedOperation=rebase when rebase-merge dir exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    fs.mkdirSync(path.join(dir, ".git", "rebase-merge"), { recursive: true });

    const health = await inspectRepo({ repoDir: dir });

    expect(health.interruptedOperation).toBe("rebase");
  });

  test("interruptedOperation=rebase when rebase-apply dir exists", async () => {
    const dir = await makeTempDir();
    await makeCleanRepo(dir);

    fs.mkdirSync(path.join(dir, ".git", "rebase-apply"), { recursive: true });

    const health = await inspectRepo({ repoDir: dir });

    expect(health.interruptedOperation).toBe("rebase");
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
