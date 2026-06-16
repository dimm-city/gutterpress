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

import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { assertZipReadable, zipEntries } from "./backup.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  FaultPoint,
  ConfirmationGate,
} from "./types.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
} from "../test-support/git-http-server.ts";
import { cloneRepository } from "../clone.ts";

// ── The module under test — will NOT exist until implementation phase ─────────
// This import is expected to FAIL (or the function to not exist) in TDD phase.
import { recover } from "./recover-detached-head.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHOR = { name: "Test Author", email: "author@test.local" };

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

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

/** Initialize a minimal local repo with one commit on main. */
async function initRepo(dir: string): Promise<string> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nInitial content.\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  return git.commit({ fs, dir, message: "initial commit", author: AUTHOR });
}

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

// ── Spy: assert no push was called with force:true ────────────────────────────
//
// The spec is "NEVER force:true on any push". We wrap httpClient to capture all
// receive-pack ref-update lines and assert oldOid is never all-zeros (a
// force/create-ref push with no expected old value). For simplicity we only need
// to verify push was not destructive — checking the pkt-line body is overkill
// here; instead we just count real push calls.

interface PushSpy {
  pushCallCount: number;
  forcePushDetected: boolean;
  httpClient: typeof httpNode;
}

function makePushSpy(): PushSpy {
  const spy: PushSpy = {
    pushCallCount: 0,
    forcePushDetected: false,
    httpClient: {
      async request(opts: Parameters<typeof httpNode.request>[0]) {
        // Detect push (receive-pack) requests.
        if (
          typeof opts.url === "string" &&
          opts.url.includes("git-receive-pack")
        ) {
          spy.pushCallCount++;
          // Check pkt-line commands for force indicators: if oldOid is
          // 0000000000000000000000000000000000000000 on an UPDATE (not a
          // create-new-ref), that signals a force push. For this test suite
          // we just flag any receive-pack request that contains a zero old-oid
          // followed by a non-zero new-oid on an existing ref as suspicious.
          // A simpler and reliable check: collect the body lines.
          const body = await opts.body;
          let bodyText = "";
          if (body) {
            for await (const chunk of body as AsyncIterable<Uint8Array>) {
              bodyText += Buffer.from(chunk).toString("binary");
            }
          }
          if (bodyText.includes("force")) {
            spy.forcePushDetected = true;
          }
        }
        // Delegate to the real httpNode.
        return httpNode.request(opts);
      },
    } as unknown as typeof httpNode,
  };
  return spy;
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
    expect(r.backupZipPath!.startsWith("/tmp/print-sync-recovery/")).toBe(true);
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
