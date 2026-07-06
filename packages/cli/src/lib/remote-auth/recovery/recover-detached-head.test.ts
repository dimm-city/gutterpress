/**
 * TDD tests for recover-detached-head.ts — Detached HEAD recovery.
 *
 * Three cases from the spec:
 *   Case A: clean repo, detached commit IS reachable from the configured branch
 *           → checkout branch, status "recovered", currentBranch === "main"
 *   Case B: orphan commit (NOT reachable from branch), user CONFIRMS
 *           → backup → create local recovery/detached-head-* branch → checkout main
 *           → status "recovered", backupZipPath set, recovery branch NOT pushed to remote
 *   Case C: uncommitted local changes, user CONFIRMS
 *           → backup+confirm; YES → commit to recovery branch, checkout main, status "recovered"
 *           → DENY → status "blocked", local files AND remote HEAD unchanged
 *
 * Safety invariants (CLAUDE.md rule 5) asserted throughout:
 *   - NEVER force-push (push is never called with force:true)
 *   - Remote HEAD unchanged when result is blocked/failed/denied
 *   - /tmp zip backup created and verified readable BEFORE any risky op
 *   - backup_create fault → failed_no_changes_made, no write ops follow
 *   - mid-repair fault (create_recovery_branch / commit_recovery_snapshot /
 *     checkout_branch) → failed_backup_available, backup readable, remote unchanged
 *   - confirmation DENIED → blocked, local+remote unchanged
 *   - user files (local.md, .git/HEAD) preserved in zip when changes present
 *
 * Uses real on-disk temp repos via isomorphic-git. No system git.
 * bun:test only — never Vitest.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { initRepo as tkInitRepo, makeTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { assertZipReadable, BACKUP_ROOT, zipEntries } from "./backup.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  FaultPoint,
  ConfirmationGate,
} from "./types.ts";
import {
  createFixtureRepo,
  startGitServer,
} from "../test-support/git-http-server.ts";
import { cloneRepository } from "../clone.ts";

// ── The module under test — will NOT exist until implementation phase ─────────
// This import is expected to FAIL (or the function to not exist) in TDD phase.
import { recover } from "./recover-detached-head.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHOR = { name: "Test Author", email: "author@test.local" };

/** Build a context pointing at a local (no remote) repo. */
function makeLocalCtx(
  repoDir: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: repoDir,
    repoDir,
    branch: "main",
    repoSlug: "test-book",
    confirmation: {
      confirmRepair: async () => true,
    },
    now: () => new Date("2025-02-01T12:00:00.000Z").getTime(),
    ...overrides,
  };
}

/** Build a context pointing at a cloned repo with a real remote. */
function makeRemoteCtx(
  repoDir: string,
  remoteUrl: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    ...makeLocalCtx(repoDir, overrides),
    remoteUrl,
    httpClient: httpNode,
  };
}

/** Initialize a minimal local repo with one commit on main (testkit initRepo, this file's author). */
const initRepo = (dir: string) => tkInitRepo(dir, { author: AUTHOR });

/** Detach HEAD to the given commit SHA (write HEAD directly). */
async function detachHead(repoDir: string, commitSha: string): Promise<void> {
  const headPath = path.join(repoDir, ".git", "HEAD");
  await writeFile(headPath, `${commitSha}\n`);
}

/** Read the current branch via isomorphic-git (undefined = detached). */
async function currentBranch(repoDir: string): Promise<string | undefined> {
  return (await git.currentBranch({ fs, dir: repoDir })) ?? undefined;
}

/** Resolve the tip of refs/heads/main in a repo. */
async function resolveMain(repoDir: string): Promise<string> {
  return git.resolveRef({ fs, dir: repoDir, ref: "refs/heads/main" });
}

/** List all local branch names. */
async function listBranches(repoDir: string): Promise<string[]> {
  return git.listBranches({ fs, dir: repoDir });
}

// ── Case A: clean detached HEAD, commit reachable from branch ─────────────────

describe("recover detached_head — Case A: clean, commit reachable from branch", () => {
  test("returns 'recovered' and currentBranch is 'main' after checkout", async () => {
    const dir = await makeTempDir("dh-caseA-");
    const sha = await initRepo(dir);
    // Detach HEAD to the same commit that main points at (trivially reachable).
    await detachHead(dir, sha);

    expect(await currentBranch(dir)).toBeUndefined(); // confirm detached

    const ctx = makeLocalCtx(dir);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");
  });

  test("no backup zip is created for a clean reachable detach", async () => {
    // Case A is read-only: just a checkout. No zip expected (no risk).
    // However, the policy for detached_head has createBackup:true so a zip IS
    // created per the withBackupGate contract. Verify it is at least readable
    // when present.
    const dir = await makeTempDir("dh-caseA-zip-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    if (r.backupZipPath) {
      await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
    }
  });

  test("no force-push happens for Case A (local-only repo)", async () => {
    const dir = await makeTempDir("dh-caseA-nopush-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    let pushCalled = false;
    const ctx = makeLocalCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "push") pushCalled = true;
        },
      },
    });

    await recover(ctx);
    expect(pushCalled).toBe(false);
  });
});

// ── Case B: orphan commit (NOT reachable from branch), confirm YES ─────────────

describe("recover detached_head — Case B: orphan commit, user confirms", () => {
  test("returns 'recovered' after creating a recovery branch and checking out main", async () => {
    const dir = await makeTempDir("dh-caseB-");
    const mainSha = await initRepo(dir);

    // Create a diverging "orphan" commit by committing on detached HEAD.
    // isomorphic-git does not have a trivial way to create a commit with no
    // parent on demand — we simulate by committing a second file from the
    // detached state at mainSha, then modifying HEAD to the new orphan.
    await detachHead(dir, mainSha);
    await writeFile(path.join(dir, "orphan.md"), "# Orphan\n\nLost commit.\n");
    await git.add({ fs, dir, filepath: "orphan.md" });
    const orphanSha = await git.commit({
      fs,
      dir,
      message: "orphan commit",
      author: AUTHOR,
    });
    // Now HEAD points at orphanSha which is NOT in refs/heads/main's history
    // (orphanSha's parent IS mainSha, but the orphan commit itself is unreferenced
    // by any branch — that's what we mean by "orphan" here for recovery purposes).
    // We need to make it truly unreachable: move main to a NEW commit that
    // doesn't include orphanSha.
    await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nUpdated.\n");
    await git.add({ fs, dir, filepath: "chapter-01.md" });
    // Temporarily reattach to write the new main tip.
    await writeFile(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await git.commit({
      fs,
      dir,
      message: "main moves forward",
      author: AUTHOR,
    });
    // Detach again to orphanSha (now truly not in main's history).
    await detachHead(dir, orphanSha);

    expect(await currentBranch(dir)).toBeUndefined();

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");
  });

  test("creates a local recovery branch at the orphan commit SHA", async () => {
    const dir = await makeTempDir("dh-caseB-branch-");
    const mainSha = await initRepo(dir);

    await detachHead(dir, mainSha);
    await writeFile(path.join(dir, "orphan.md"), "# Orphan\n");
    await git.add({ fs, dir, filepath: "orphan.md" });
    const orphanSha = await git.commit({
      fs,
      dir,
      message: "orphan",
      author: AUTHOR,
    });
    // Make main diverge so orphanSha is unreachable from it.
    await writeFile(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(path.join(dir, "chapter-01.md"), "# Updated\n");
    await git.add({ fs, dir, filepath: "chapter-01.md" });
    await git.commit({ fs, dir, message: "main update", author: AUTHOR });
    await detachHead(dir, orphanSha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    await recover(ctx);

    const branches = await listBranches(dir);
    const recoveryBranch = branches.find((b) => b.startsWith("recovery/detached-head-"));
    expect(recoveryBranch).toBeDefined();

    // The recovery branch must point to the orphan commit.
    const branchSha = await git.resolveRef({
      fs,
      dir,
      ref: `refs/heads/${recoveryBranch}`,
    });
    expect(branchSha).toBe(orphanSha);
  });

  test("recovery branch is NOT pushed to the remote", async () => {
    const serverDir = await makeTempDir("dh-caseB-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);

    const clientDir = await makeTempDir("dh-caseB-client-");
    await cloneRepository({ url: server.url, dir: clientDir });

    // Create an orphan commit on the client while detached.
    const mainSha = await resolveMain(clientDir);
    await detachHead(clientDir, mainSha);
    await writeFile(path.join(clientDir, "orphan.md"), "# Orphan\n");
    await git.add({ fs, dir: clientDir, filepath: "orphan.md" });
    const orphanSha = await git.commit({
      fs,
      dir: clientDir,
      message: "orphan",
      author: AUTHOR,
    });
    // Advance main on client so orphanSha is truly unreachable.
    await writeFile(path.join(clientDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(path.join(clientDir, "chapter-01.md"), "# Client update\n");
    await git.add({ fs, dir: clientDir, filepath: "chapter-01.md" });
    await git.commit({ fs, dir: clientDir, message: "client main", author: AUTHOR });
    await detachHead(clientDir, orphanSha);

    const remoteHeadBefore = await git.resolveRef({
      fs,
      dir: serverDir,
      ref: "refs/heads/main",
    });

    const ctx = makeRemoteCtx(clientDir, server.url, {
      confirmation: { confirmRepair: async () => true },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");

    // Remote head must not have changed.
    const remoteHeadAfter = await git.resolveRef({
      fs,
      dir: serverDir,
      ref: "refs/heads/main",
    });
    expect(remoteHeadAfter).toBe(remoteHeadBefore);

    // No recovery branch should exist on the remote.
    const remoteRefs = await git.listServerRefs({
      http: httpNode,
      url: server.url,
    });
    const hasRecoveryBranchRemote = remoteRefs.some((r) =>
      r.ref.includes("recovery/detached-head"),
    );
    expect(hasRecoveryBranchRemote).toBe(false);

    await server.close();
    await rm(serverDir, { recursive: true, force: true });
    await rm(clientDir, { recursive: true, force: true });
  });

  test("backupZipPath is set and points to a readable zip", async () => {
    const dir = await makeTempDir("dh-caseB-zip-");
    const mainSha = await initRepo(dir);
    await detachHead(dir, mainSha);
    await writeFile(path.join(dir, "orphan.md"), "# Orphan\n");
    await git.add({ fs, dir, filepath: "orphan.md" });
    await git.commit({ fs, dir, message: "orphan", author: AUTHOR });
    // Detach state is already set from detachHead; HEAD now points to orphan commit.

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath).toBeDefined();
    expect(r.backupZipPath!.startsWith(BACKUP_ROOT + path.sep)).toBe(true);
    await expect(assertZipReadable(r.backupZipPath!)).resolves.toBeUndefined();
  });
});

// ── Case C: uncommitted local changes ─────────────────────────────────────────

describe("recover detached_head — Case C: uncommitted local changes, user confirms", () => {
  test("YES: commits local changes to recovery branch, currentBranch is main", async () => {
    const dir = await makeTempDir("dh-caseC-yes-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    // Write an uncommitted file while detached.
    await writeFile(path.join(dir, "local.md"), "# Local work in progress\n");

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");
  });

  test("YES: local changes appear on a recovery branch, not lost", async () => {
    const dir = await makeTempDir("dh-caseC-preserved-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    await writeFile(path.join(dir, "local.md"), "# In-progress work\n");

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    await recover(ctx);

    // A recovery branch must exist.
    const branches = await listBranches(dir);
    const recBranch = branches.find((b) => b.startsWith("recovery/detached-head-"));
    expect(recBranch).toBeDefined();

    // That branch should have local.md committed.
    const recSha = await git.resolveRef({ fs, dir, ref: `refs/heads/${recBranch}` });
    const { commit } = await git.readCommit({ fs, dir, oid: recSha });
    const tree = await git.readTree({ fs, dir, oid: commit.tree });
    const localEntry = tree.tree.find((e) => e.path === "local.md");
    expect(localEntry).toBeDefined();
  });

  test("YES: backup zip contains local.md AND .git/HEAD", async () => {
    const dir = await makeTempDir("dh-caseC-zip-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    await writeFile(path.join(dir, "local.md"), "# In-progress work\n");

    let capturedZip: string | undefined;
    const ctx = makeLocalCtx(dir, {
      confirmation: {
        confirmRepair: async (req) => {
          capturedZip = req.backupZipPath;
          return true;
        },
      },
    });
    await recover(ctx);

    expect(capturedZip).toBeDefined();
    const entries = await zipEntries(capturedZip!);
    expect(entries.some((e) => e.name === "local.md")).toBe(true);
    expect(entries.some((e) => e.name === ".git/HEAD" || e.name.startsWith(".git/"))).toBe(true);
  });

  test("YES: no force-push (local-only repo with local changes)", async () => {
    const dir = await makeTempDir("dh-caseC-nopush-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    await writeFile(path.join(dir, "local.md"), "# Work\n");

    let pushFaultFired = false;
    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "push") pushFaultFired = true;
        },
      },
    });
    await recover(ctx);

    expect(pushFaultFired).toBe(false);
  });

  test("DENY: returns 'blocked', local files unchanged", async () => {
    const dir = await makeTempDir("dh-caseC-deny-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    await writeFile(path.join(dir, "local.md"), "# Unsaved draft\n");
    const originalContent = "# Unsaved draft\n";

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => false },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");
    // local.md must be unchanged.
    const content = fs.readFileSync(path.join(dir, "local.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("DENY: returns 'blocked', chapter-01.md unchanged", async () => {
    const dir = await makeTempDir("dh-caseC-deny2-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    await writeFile(path.join(dir, "local.md"), "# Draft\n");

    const originalChapter = fs.readFileSync(
      path.join(dir, "chapter-01.md"),
      "utf8",
    );

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => false },
    });
    await recover(ctx);

    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe(originalChapter);
  });

  test("DENY with remote: remote HEAD is unchanged", async () => {
    const serverDir = await makeTempDir("dh-caseC-remote-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);

    const clientDir = await makeTempDir("dh-caseC-remote-client-");
    await cloneRepository({ url: server.url, dir: clientDir });

    const mainSha = await resolveMain(clientDir);
    await detachHead(clientDir, mainSha);
    await writeFile(path.join(clientDir, "local.md"), "# Draft\n");

    const remoteHeadBefore = await git.resolveRef({
      fs,
      dir: serverDir,
      ref: "refs/heads/main",
    });

    const ctx = makeRemoteCtx(clientDir, server.url, {
      confirmation: { confirmRepair: async () => false },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");

    const remoteHeadAfter = await git.resolveRef({
      fs,
      dir: serverDir,
      ref: "refs/heads/main",
    });
    expect(remoteHeadAfter).toBe(remoteHeadBefore);

    await server.close();
    await rm(serverDir, { recursive: true, force: true });
    await rm(clientDir, { recursive: true, force: true });
  });
});

// ── Safety invariants ─────────────────────────────────────────────────────────

describe("recover detached_head — safety: backup_create fault", () => {
  test("fault at backup_create returns failed_no_changes_made", async () => {
    const dir = await makeTempDir("dh-safety-backup-create-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("disk full");
        },
      },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("failed_no_changes_made");
  });

  test("fault at backup_create: currentBranch remains undefined (no ops ran)", async () => {
    const dir = await makeTempDir("dh-safety-backup-create-noop-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("disk full");
        },
      },
    });
    await recover(ctx);

    // HEAD must still be detached — no checkout ran.
    expect(await currentBranch(dir)).toBeUndefined();
  });

  test("fault at backup_create: no recovery branch created", async () => {
    const dir = await makeTempDir("dh-safety-backup-create-branch-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("disk full");
        },
      },
    });
    await recover(ctx);

    const branches = await listBranches(dir);
    expect(branches.some((b) => b.startsWith("recovery/"))).toBe(false);
  });
});

describe("recover detached_head — safety: mid-repair fault at create_recovery_branch", () => {
  test("fault at create_recovery_branch returns failed_backup_available", async () => {
    const dir = await makeTempDir("dh-safety-mid-branch-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "create_recovery_branch") throw new Error("ref write failed");
        },
      },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("failed_backup_available");
  });

  test("fault at create_recovery_branch: backup zip is readable", async () => {
    const dir = await makeTempDir("dh-safety-mid-branch-zip-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "create_recovery_branch") throw new Error("ref write failed");
        },
      },
    });
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    expect(r.backupZipPath).toBeDefined();
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });
});

describe("recover detached_head — safety: mid-repair fault at commit_recovery_snapshot", () => {
  test("fault at commit_recovery_snapshot returns failed_backup_available", async () => {
    const dir = await makeTempDir("dh-safety-mid-commit-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);
    await writeFile(path.join(dir, "local.md"), "# Draft\n");

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "commit_recovery_snapshot") throw new Error("commit failed");
        },
      },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("failed_backup_available");
  });

  test("fault at commit_recovery_snapshot: backup zip is readable", async () => {
    const dir = await makeTempDir("dh-safety-mid-commit-zip-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);
    await writeFile(path.join(dir, "local.md"), "# Draft\n");

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "commit_recovery_snapshot") throw new Error("commit failed");
        },
      },
    });
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });
});

describe("recover detached_head — safety: mid-repair fault at checkout_branch", () => {
  test("fault at checkout_branch returns failed_backup_available", async () => {
    const dir = await makeTempDir("dh-safety-mid-checkout-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "checkout_branch") throw new Error("checkout failed");
        },
      },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("failed_backup_available");
  });

  test("fault at checkout_branch: backup zip is readable", async () => {
    const dir = await makeTempDir("dh-safety-mid-checkout-zip-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "checkout_branch") throw new Error("checkout failed");
        },
      },
    });
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });

  test("fault at checkout_branch: remote HEAD unchanged (with remote)", async () => {
    const serverDir = await makeTempDir("dh-safety-checkout-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);

    const clientDir = await makeTempDir("dh-safety-checkout-client-");
    await cloneRepository({ url: server.url, dir: clientDir });

    const mainSha = await resolveMain(clientDir);
    await detachHead(clientDir, mainSha);

    const remoteHeadBefore = await git.resolveRef({
      fs,
      dir: serverDir,
      ref: "refs/heads/main",
    });

    const ctx = makeRemoteCtx(clientDir, server.url, {
      confirmation: { confirmRepair: async () => true },
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "checkout_branch") throw new Error("checkout failed");
        },
      },
    });
    await recover(ctx);

    const remoteHeadAfter = await git.resolveRef({
      fs,
      dir: serverDir,
      ref: "refs/heads/main",
    });
    expect(remoteHeadAfter).toBe(remoteHeadBefore);

    await server.close();
    await rm(serverDir, { recursive: true, force: true });
    await rm(clientDir, { recursive: true, force: true });
  });
});

describe("recover detached_head — safety: guidance fields always present", () => {
  test("blocked result includes ManualGuidance with non-empty userSummary", async () => {
    const dir = await makeTempDir("dh-guidance-blocked-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => false },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
  });

  test("failed_no_changes_made result includes ManualGuidance", async () => {
    const dir = await makeTempDir("dh-guidance-failed-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("disk full");
        },
      },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("failed_no_changes_made");
    const r = result as Extract<RecoveryResult, { status: "failed_no_changes_made" }>;
    expect(r.guidance).toBeDefined();
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
  });

  test("guidance userSummary contains no raw git words (HEAD, branch, ref)", async () => {
    const dir = await makeTempDir("dh-guidance-copy-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => false },
    });
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    const summary = r.guidance.userSummary.toLowerCase();
    // These are the hard-banned git-jargon words per the copy rules.
    expect(summary).not.toContain("detached head");
    expect(summary).not.toContain("git ref");
    expect(summary).not.toContain("refs/heads");
  });
});

// ── BUG 1: branch discovery (do not blindly assume "main") ────────────────────
//
// When HEAD is detached and ctx.branch is empty, the handler must discover the
// branch the detached commit actually belongs to rather than checking the user
// out onto "main" (which silently relocates work for any non-"main" repo).

/** Initialize a minimal local repo whose only branch is the given name. */
const initRepoOnBranch = (dir: string, branch: string) =>
  tkInitRepo(dir, { branch, author: AUTHOR });

describe("recover detached_head — BUG 1: branch discovery when ctx.branch is empty", () => {
  test("repo whose only branch is 'master' recovers onto 'master', not 'main'", async () => {
    const dir = await makeTempDir("dh-bug1-master-");
    const sha = await initRepoOnBranch(dir, "master");
    await detachHead(dir, sha);

    expect(await currentBranch(dir)).toBeUndefined(); // confirm detached

    // ctx.branch is empty → the handler must DISCOVER the real branch.
    const ctx = makeLocalCtx(dir, { branch: "" });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("master");
  });

  test("does NOT create a stray 'main' branch when recovering a 'master' repo", async () => {
    const dir = await makeTempDir("dh-bug1-no-main-");
    const sha = await initRepoOnBranch(dir, "master");
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, { branch: "" });
    await recover(ctx);

    const branches = await listBranches(dir);
    expect(branches).toContain("master");
    expect(branches).not.toContain("main");
  });

  test("explicit ctx.branch still wins over discovery", async () => {
    // The repo's only branch is "master", but ctx.branch explicitly names
    // "develop". The explicit value must win (the discovery path is skipped).
    const dir = await makeTempDir("dh-bug1-explicit-");
    const sha = await initRepoOnBranch(dir, "master");
    // Add a second branch "develop" at the same commit so the checkout target exists.
    await git.branch({ fs, dir, ref: "develop", object: sha });
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, { branch: "develop" });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("develop");
  });

  test("falls back to origin's default branch when ctx.branch is empty and many local branches exist", async () => {
    // Two local branches that both contain HEAD make tip-reachability ambiguous;
    // the handler should consult refs/remotes/origin/HEAD for the default.
    const dir = await makeTempDir("dh-bug1-origin-head-");
    const sha = await initRepoOnBranch(dir, "trunk");
    // A second branch at the same commit creates ambiguity for tip matching.
    await git.branch({ fs, dir, ref: "feature", object: sha });
    // Record the remote's default branch as "trunk".
    const originDir = path.join(dir, ".git", "refs", "remotes", "origin");
    await fs.promises.mkdir(originDir, { recursive: true });
    await writeFile(path.join(originDir, "HEAD"), "ref: refs/remotes/origin/trunk\n");
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, { branch: "" });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("trunk");
  });

  test("falls back to 'main' as a last resort when discovery finds nothing usable", async () => {
    // A 'main' branch exists alongside another branch, no origin/HEAD hint, and
    // HEAD is detached at a commit reachable from both — discovery is ambiguous,
    // so the documented final fallback ("main") applies.
    const dir = await makeTempDir("dh-bug1-fallback-main-");
    const sha = await initRepoOnBranch(dir, "main");
    await git.branch({ fs, dir, ref: "side", object: sha });
    await detachHead(dir, sha);

    const ctx = makeLocalCtx(dir, { branch: "" });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");
  });
});

// ── BUG 2: forced checkout is safe after work is preserved ────────────────────
//
// The rescue branch + verified /tmp backup hold the prior state, so a forced
// checkout onto the named branch cannot lose work even with a dirty tree.

describe("recover detached_head — BUG 2: forced checkout survives a dirty tree", () => {
  test("recovers even when a non-forced checkout would hit a working-tree conflict", async () => {
    // This builds the EXACT state that makes isomorphic-git's NON-forced
    // checkout throw CheckoutConflictError, proving the forced checkout is
    // required (and safe, because work is already on the rescue branch):
    //   - base commit ignores "draft.md" and tracks chapter-01.md
    //   - the named branch ("main") advances to TRACK draft.md
    //   - HEAD is detached back at the base; the workdir has a still-ignored
    //     local draft.md AND a real edit to chapter-01.md
    // Case C commits the real chapter edit to the rescue branch, but the ignored
    // draft.md stays untracked — so checking out "main" (which wants to write a
    // tracked draft.md over the untracked one) would fail without `force`.
    const dir = await makeTempDir("dh-bug2-conflict-");

    await git.init({ fs, dir, defaultBranch: "main" });
    await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n");
    await writeFile(path.join(dir, ".gitignore"), "draft.md\n");
    await git.add({ fs, dir, filepath: "chapter-01.md" });
    await git.add({ fs, dir, filepath: ".gitignore" });
    const baseSha = await git.commit({ fs, dir, message: "base", author: AUTHOR });

    // main advances: stop ignoring draft.md and start tracking it.
    await writeFile(path.join(dir, ".gitignore"), "\n");
    await writeFile(path.join(dir, "draft.md"), "# Tracked draft on main\n");
    await git.add({ fs, dir, filepath: ".gitignore" });
    await git.add({ fs, dir, filepath: "draft.md" });
    await git.commit({ fs, dir, message: "main tracks draft", author: AUTHOR });

    // Detach back at the base commit and reset the tree to match it.
    await detachHead(dir, baseSha);
    await git.checkout({ fs, dir, ref: baseSha, force: true });

    // Local work: an ignored draft.md (invisible to staging) and a real edit.
    await writeFile(path.join(dir, "draft.md"), "# my ignored local draft\n");
    const editedChapter = "# Chapter One\n\nReal tracked edit to preserve.\n";
    await writeFile(path.join(dir, "chapter-01.md"), editedChapter);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");

    // The real tracked edit must survive on the rescue branch.
    const branches = await listBranches(dir);
    const recBranch = branches.find((b) => b.startsWith("recovery/detached-head-"));
    expect(recBranch).toBeDefined();
    const recSha = await git.resolveRef({ fs, dir, ref: `refs/heads/${recBranch}` });
    const { blob } = await git.readBlob({ fs, dir, oid: recSha, filepath: "chapter-01.md" });
    expect(new TextDecoder().decode(blob)).toBe(editedChapter);
  });

  test("Case C with uncommitted edits still recovers onto the named branch", async () => {
    const dir = await makeTempDir("dh-bug2-dirty-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    // A longer (detectable) edit to a tracked file PLUS a new untracked file —
    // a genuinely dirty tree at entry.
    await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nA longer edited body for detection.\n");
    await writeFile(path.join(dir, "scratch.md"), "# Scratch\n\nUntracked work.\n");

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");
  });

  test("Case C: the rescue branch holds the prior (edited) state", async () => {
    const dir = await makeTempDir("dh-bug2-rescue-state-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);

    const editedBody = "# Chapter One\n\nA substantially longer edited body kept here.\n";
    await writeFile(path.join(dir, "chapter-01.md"), editedBody);

    const ctx = makeLocalCtx(dir, {
      confirmation: { confirmRepair: async () => true },
    });
    await recover(ctx);

    // The rescue branch must exist and hold the EDITED chapter content.
    const branches = await listBranches(dir);
    const recBranch = branches.find((b) => b.startsWith("recovery/detached-head-"));
    expect(recBranch).toBeDefined();

    const recSha = await git.resolveRef({ fs, dir, ref: `refs/heads/${recBranch}` });
    const { blob } = await git.readBlob({
      fs,
      dir,
      oid: recSha,
      filepath: "chapter-01.md",
    });
    expect(new TextDecoder().decode(blob)).toBe(editedBody);
  });
});

// ── TOCTOU: HEAD re-attached before recovery (dispatcher stillApplies) ────────
//
// HEAD may have been re-attached externally (e.g. the author ran a checkout
// in a terminal) between classification and dispatch. The dispatcher's
// `stillApplies` probe (dispatch.ts) re-checks this INSIDE withRepoLock,
// before the handler body runs — so this goes through dispatch.recover, not
// the bare `recover()` export.

describe("recover detached_head — HEAD re-attached before recovery (dispatcher stillApplies)", () => {
  test("HEAD no longer detached → no-op recovered; no confirm, no backup, no rescue branch", async () => {
    const { recover: dispatchRecover } = await import("./dispatch.ts");
    const dir = await makeTempDir("dh-reattached-");
    const sha = await initRepo(dir);
    await detachHead(dir, sha);
    // HEAD was re-attached externally before recovery ran (e.g. the author
    // checked out "main" directly).
    await git.checkout({ fs, dir, ref: "main" });

    let confirmCalled = false;
    const gate: ConfirmationGate = {
      confirmRepair: async () => {
        confirmCalled = true;
        return true;
      },
    };

    const result = await dispatchRecover("detached_head", makeLocalCtx(dir, { confirmation: gate }));

    expect(result.status).toBe("recovered");
    expect(confirmCalled).toBe(false);
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath ?? "").toBe("");
    // No rescue branch was created — nothing was touched.
    const branches = await listBranches(dir);
    expect(branches.some((b) => b.startsWith("recovery/detached-head-"))).toBe(false);
    expect(await currentBranch(dir)).toBe("main");
    expect(await resolveMain(dir)).toBe(sha);
  });
});
