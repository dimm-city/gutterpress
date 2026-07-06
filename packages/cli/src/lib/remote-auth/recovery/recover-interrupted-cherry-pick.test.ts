/**
 * TDD tests for recover-interrupted-cherry-pick.ts — abort a stuck cherry-pick.
 *
 * A conflicted cherry-pick does NOT advance HEAD (it stops before committing),
 * so there is no ref to rewind — only the half-applied index/worktree conflict
 * state to discard. The abort force-checks-out the current branch (resetting
 * index+worktree to HEAD) and removes CHERRY_PICK_HEAD / MERGE_MSG / sequencer.
 *
 * Safety invariants asserted:
 *   - /tmp zip backup created + verified BEFORE any repair op.
 *   - confirmation DENIED → blocked, CHERRY_PICK_HEAD still present.
 *   - backup_create fault → failed_no_changes_made, no writes.
 *   - mid-repair fault (checkout_branch) → failed_backup_available, backup readable.
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
import type {
  ConfirmationGate,
  FaultPoint,
  RecoveryContext,
  RecoveryResult,
} from "./types.ts";

import { recover } from "./recover-interrupted-cherry-pick.ts";

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

/** Fabricate an interrupted-cherry-pick on-disk state (HEAD stays attached). */
async function fabricateCherryPick(dir: string, pickedSha: string): Promise<void> {
  await writeFile(path.join(dir, ".git", "CHERRY_PICK_HEAD"), `${pickedSha}\n`);
  await writeFile(path.join(dir, ".git", "MERGE_MSG"), "picked commit\n");
}

function hasCherryPickMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git", "CHERRY_PICK_HEAD"));
}

// ── recovered path ────────────────────────────────────────────────────────────

describe("recover interrupted_cherry_pick — recovered", () => {
  test("clears CHERRY_PICK_HEAD, resets worktree, keeps branch attached", async () => {
    const dir = await makeTempDir("cp-recovered-");
    const sha = await initRepo(dir);
    await fabricateCherryPick(dir, sha);
    // Dirty index + worktree: a half-applied conflict edit.
    await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\n<<< HALF APPLIED >>>\n");

    const result = await recover(makeCtx(dir));

    expect(result.status).toBe("recovered");
    expect(hasCherryPickMarker(dir)).toBe(false);
    expect(await currentBranch(dir)).toBe("main");
    // Worktree reset to HEAD content.
    expect(fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8")).toBe(
      "# Chapter One\n\nOriginal.\n",
    );

    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath).toBeTruthy();
    await expect(assertZipReadable(r.backupZipPath!)).resolves.toBeUndefined();
  });

  test("also removes MERGE_MSG and sequencer state", async () => {
    const dir = await makeTempDir("cp-seq-");
    const sha = await initRepo(dir);
    await fabricateCherryPick(dir, sha);
    fs.mkdirSync(path.join(dir, ".git", "sequencer"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "sequencer", "todo"), "pick abc\n");

    const result = await recover(makeCtx(dir));

    expect(result.status).toBe("recovered");
    expect(fs.existsSync(path.join(dir, ".git", "MERGE_MSG"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".git", "sequencer"))).toBe(false);
  });
});

// ── DENY ──────────────────────────────────────────────────────────────────────

describe("recover interrupted_cherry_pick — confirmation denied", () => {
  test("DENY → blocked, marker still present", async () => {
    const dir = await makeTempDir("cp-deny-");
    const sha = await initRepo(dir);
    await fabricateCherryPick(dir, sha);

    const result = await recover(makeCtx(dir, { confirmation: DENY }));

    expect(result.status).toBe("blocked");
    expect(hasCherryPickMarker(dir)).toBe(true);
  });
});

// ── Safety: backup_create fault ─────────────────────────────────────────────────

describe("recover interrupted_cherry_pick — backup_create fault", () => {
  test("fault at backup_create → failed_no_changes_made, marker present", async () => {
    const dir = await makeTempDir("cp-backupfault-");
    const sha = await initRepo(dir);
    await fabricateCherryPick(dir, sha);

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
    expect(hasCherryPickMarker(dir)).toBe(true);
  });
});

// ── Safety: mid-repair fault ────────────────────────────────────────────────────

describe("recover interrupted_cherry_pick — mid-repair fault", () => {
  test("fault at checkout_branch → failed_backup_available, backup readable", async () => {
    const dir = await makeTempDir("cp-midfault-");
    const sha = await initRepo(dir);
    await fabricateCherryPick(dir, sha);

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

describe("recover interrupted_cherry_pick — copy discipline", () => {
  test("blocked guidance userSummary has no git jargon; supportDetails names the state", async () => {
    const dir = await makeTempDir("cp-copy-");
    const sha = await initRepo(dir);
    await fabricateCherryPick(dir, sha);

    const result = await recover(makeCtx(dir, { confirmation: DENY }));
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    const s = r.guidance.userSummary.toLowerCase();
    expect(s).not.toContain("cherry-pick");
    expect(s).not.toContain("cherry pick");
    expect(s).not.toContain("commit");
    expect(s).not.toContain("branch");
    expect(s).not.toContain("head");
    expect(r.guidance.supportDetails).toContain("Interrupted cherry-pick detected");
    expect(r.guidance.supportDetails).toContain("interrupted_cherry_pick");
  });
});

// ── TOCTOU: marker vanished before recovery ─────────────────────────────────────
//
// This precondition is now enforced by the DISPATCHER's `stillApplies` probe
// (dispatch.ts), INSIDE withRepoLock, before the bare handler is ever invoked
// — so this test goes through dispatch.recover, not the bare `recover()`
// export (the shared abort skeleton no longer has its own copy of this guard).

describe("recover interrupted_cherry_pick — marker vanished before recovery", () => {
  test("no CHERRY_PICK_HEAD → no-op recovered; worktree preserved, no backup, no confirm", async () => {
    const { recover: dispatchRecover } = await import("./dispatch.ts");
    const dir = await makeTempDir("cp-vanished-");
    await initRepo(dir);
    // The cherry-pick was finished/aborted externally between inspect and recover:
    // NO CHERRY_PICK_HEAD. A local edit is present that must NOT be discarded.
    await writeFile(path.join(dir, "chapter-01.md"), "LOCAL EDIT — keep me\n");

    let confirmCalled = false;
    const gate: ConfirmationGate = {
      confirmRepair: async () => {
        confirmCalled = true;
        return true;
      },
    };

    const result = await dispatchRecover("interrupted_cherry_pick", makeCtx(dir, { confirmation: gate }));

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
