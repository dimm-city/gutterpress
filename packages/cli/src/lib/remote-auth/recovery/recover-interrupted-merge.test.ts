/**
 * Tests for recover-interrupted-merge.ts — abort a stuck native-git merge.
 *
 * A conflicted merge does NOT advance HEAD (it stops before committing), so
 * there is no ref to rewind — only the half-applied index/worktree conflict
 * state to discard. The abort force-checks-out the current branch (resetting
 * index+worktree to HEAD) and removes MERGE_HEAD / MERGE_MSG / MERGE_MODE.
 *
 * Safety invariants asserted:
 *   - /tmp zip backup created + verified BEFORE any repair op.
 *   - confirmation DENIED → blocked, MERGE_HEAD still present.
 *   - backup_create fault → failed_no_changes_made, no writes.
 *   - mid-repair fault (checkout_branch) → failed_backup_available, backup readable.
 *   - classifier routes hasInterruptedMerge → interrupted_merge (the runtime
 *     path gap this handler closes — previously fell through to "unknown").
 *
 * Real on-disk temp repos via isomorphic-git. No system git. bun:test only.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";

import { assertZipReadable } from "./backup.ts";
import { classifyGitError } from "./classify.ts";
import { inspectRepo } from "./inspect.ts";
import type {
  ConfirmationGate,
  FaultPoint,
  RecoveryContext,
  RecoveryResult,
} from "./types.ts";

import { recover } from "./recover-interrupted-merge.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHOR = { name: "Test Author", email: "author@test.local" };

const APPROVE: ConfirmationGate = { confirmRepair: async () => true };
const DENY: ConfirmationGate = { confirmRepair: async () => false };

function makeCtx(
  repoDir: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: repoDir,
    repoDir,
    branch: "main",
    repoSlug: "test-book",
    confirmation: APPROVE,
    now: () => new Date("2025-02-01T12:00:00.000Z").getTime(),
    ...overrides,
  };
}

async function currentBranch(repoDir: string): Promise<string | undefined> {
  return (await git.currentBranch({ fs, dir: repoDir })) ?? undefined;
}

/** One-commit repo on main; returns the HEAD sha. */
async function initRepo(dir: string): Promise<string> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nOriginal.\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  return git.commit({ fs, dir, message: "initial commit", author: AUTHOR });
}

/** Fabricate an interrupted-merge on-disk state (HEAD stays attached). */
async function fabricateMerge(dir: string, otherSha: string): Promise<void> {
  await writeFile(path.join(dir, ".git", "MERGE_HEAD"), `${otherSha}\n`);
  await writeFile(path.join(dir, ".git", "MERGE_MSG"), "Merge branch 'other'\n");
  await writeFile(path.join(dir, ".git", "MERGE_MODE"), "\n");
}

function hasMergeMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git", "MERGE_HEAD"));
}

// ── Classifier routing (the runtime-path gap this handler closes) ─────────────

describe("classify — hasInterruptedMerge routes to interrupted_merge", () => {
  test("health with MERGE_HEAD classifies as interrupted_merge, not unknown", async () => {
    const dir = await makeTempDir("im-classify-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);

    const health = await inspectRepo({ repoDir: dir });
    expect(health.hasInterruptedMerge).toBe(true);
    expect(classifyGitError(undefined, health)).toBe("interrupted_merge");
  });

  test("interrupted rebase still wins over interrupted merge (ordering)", async () => {
    const dir = await makeTempDir("im-order-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);
    fs.mkdirSync(path.join(dir, ".git", "rebase-merge"), { recursive: true });

    const health = await inspectRepo({ repoDir: dir });
    expect(classifyGitError(undefined, health)).toBe("interrupted_rebase");
  });
});

// ── recovered path ────────────────────────────────────────────────────────────

describe("recover interrupted_merge — recovered", () => {
  test("clears MERGE_HEAD, resets worktree, keeps branch attached", async () => {
    const dir = await makeTempDir("im-recovered-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);
    // Dirty index + worktree: half-applied conflict markers from a native merge.
    await writeFile(
      path.join(dir, "chapter-01.md"),
      "# Chapter One\n\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n",
    );

    const result = await recover(makeCtx(dir));

    expect(result.status).toBe("recovered");
    expect(hasMergeMarker(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, ".git", "MERGE_MSG"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".git", "MERGE_MODE"))).toBe(false);
    expect(await currentBranch(dir)).toBe("main");
    // Worktree reset to HEAD content — the conflict markers are gone.
    expect(fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8")).toBe(
      "# Chapter One\n\nOriginal.\n",
    );

    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath).toBeTruthy();
    await expect(assertZipReadable(r.backupZipPath!)).resolves.toBeUndefined();
  });
});

// ── DENY ──────────────────────────────────────────────────────────────────────

describe("recover interrupted_merge — confirmation denied", () => {
  test("DENY → blocked, marker still present", async () => {
    const dir = await makeTempDir("im-deny-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);

    const result = await recover(makeCtx(dir, { confirmation: DENY }));

    expect(result.status).toBe("blocked");
    expect(hasMergeMarker(dir)).toBe(true);
  });
});

// ── Safety: backup_create fault ─────────────────────────────────────────────────

describe("recover interrupted_merge — backup_create fault", () => {
  test("fault at backup_create → failed_no_changes_made, marker present", async () => {
    const dir = await makeTempDir("im-backupfault-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);

    const result = await recover(
      makeCtx(dir, {
        faults: {
          before: async (p: FaultPoint) => {
            if (p === "backup_create") throw new Error("disk full");
          },
        },
      }),
    );

    expect(result.status).toBe("failed_no_changes_made");
    expect(hasMergeMarker(dir)).toBe(true);
  });
});

// ── Safety: mid-repair fault ────────────────────────────────────────────────────

describe("recover interrupted_merge — mid-repair fault", () => {
  test("fault at checkout_branch → failed_backup_available, backup readable", async () => {
    const dir = await makeTempDir("im-midfault-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);

    const result = await recover(
      makeCtx(dir, {
        faults: {
          before: async (p: FaultPoint) => {
            if (p === "checkout_branch") throw new Error("checkout failed");
          },
        },
      }),
    );

    expect(result.status).toBe("failed_backup_available");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });
});

// ── Author-facing copy discipline ───────────────────────────────────────────────

describe("recover interrupted_merge — copy discipline", () => {
  test("blocked guidance userSummary has no git jargon; supportDetails names the state", async () => {
    const dir = await makeTempDir("im-copy-");
    const sha = await initRepo(dir);
    await fabricateMerge(dir, sha);

    const result = await recover(makeCtx(dir, { confirmation: DENY }));
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    const s = r.guidance.userSummary.toLowerCase();
    expect(s).not.toContain("merge");
    expect(s).not.toContain("commit");
    expect(s).not.toContain("branch");
    expect(s).not.toContain("head");
    expect(r.guidance.supportDetails).toContain("Interrupted merge detected");
    expect(r.guidance.supportDetails).toContain("interrupted_merge");
  });
});

// ── TOCTOU: marker vanished before recovery ─────────────────────────────────────
//
// This precondition is now enforced by the DISPATCHER's `stillApplies` probe
// (dispatch.ts), INSIDE withRepoLock, before the bare handler is ever invoked
// — so this test goes through dispatch.recover, not the bare `recover()`
// export (the shared abort skeleton no longer has its own copy of this guard).

describe("recover interrupted_merge — marker vanished before recovery", () => {
  test("no MERGE_HEAD → no-op recovered; worktree preserved, no backup, no confirm", async () => {
    const { recover: dispatchRecover } = await import("./dispatch.ts");
    const dir = await makeTempDir("im-vanished-");
    await initRepo(dir);
    // The merge was finished/aborted externally between inspect and recover:
    // NO MERGE_HEAD. A local edit is present that must NOT be discarded.
    await writeFile(path.join(dir, "chapter-01.md"), "LOCAL EDIT — keep me\n");

    let confirmCalled = false;
    const gate: ConfirmationGate = {
      confirmRepair: async () => {
        confirmCalled = true;
        return true;
      },
    };

    const result = await dispatchRecover("interrupted_merge", makeCtx(dir, { confirmation: gate }));

    expect(result.status).toBe("recovered");
    // No destructive path was entered: no confirmation prompt, no backup.
    expect(confirmCalled).toBe(false);
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath ?? "").toBe("");
    // The dirty worktree was NOT force-reset — the local edit survives.
    expect(fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8")).toBe(
      "LOCAL EDIT — keep me\n",
    );
  });
});
