/**
 * TDD tests for recover-interrupted-rebase.ts — abort an interrupted rebase.
 *
 * A repo left mid-rebase has a `.git/rebase-merge/` (merge/interactive backend)
 * or `.git/rebase-apply/` (am backend) directory and its HEAD is usually
 * detached at a replay commit. The abort rewinds the real branch ref to the
 * pre-rebase commit (recorded in `<stateDir>/orig-head`), re-attaches HEAD to
 * that branch, and removes the operation-state dirs.
 *
 * Safety invariants asserted:
 *   - /tmp zip backup created + verified BEFORE any repair op.
 *   - confirmation DENIED → blocked, state UNTOUCHED (markers still present).
 *   - backup_create fault → failed_no_changes_made, no writes.
 *   - mid-repair fault (checkout_branch) → failed_backup_available, backup readable.
 *   - unresolvable orig-head → failed_backup_available (backup is safe).
 *
 * Real on-disk temp repos via isomorphic-git. No system git. bun:test only.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { commitFile as tkCommitFile, makeTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";

import { assertZipReadable } from "./backup.ts";
import { withRepoLock } from "../../source-provider.ts";
import type {
  ConfirmationGate,
  FaultPoint,
  RecoveryContext,
  RecoveryResult,
} from "./types.ts";

import { recover } from "./recover-interrupted-rebase.ts";

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

async function resolveMain(repoDir: string): Promise<string> {
  return git.resolveRef({ fs, dir: repoDir, ref: "refs/heads/main" });
}

/** Commit `filename` with `body` on the current branch (testkit commitFile, this file's author). */
const commitFile = (dir: string, filename: string, body: string) =>
  tkCommitFile(dir, filename, body, { author: AUTHOR });

/** Two-commit repo on main; returns { firstSha (pre-rebase), secondSha (tip)}. */
async function initTwoCommitRepo(dir: string): Promise<{ firstSha: string; secondSha: string }> {
  await git.init({ fs, dir, defaultBranch: "main" });
  const firstSha = await commitFile(dir, "chapter-01.md", "# Chapter One\n\nOriginal.\n");
  const secondSha = await commitFile(dir, "chapter-02.md", "# Chapter Two\n\nSecond.\n");
  return { firstSha, secondSha };
}

/** Write `.git/HEAD` directly to detach HEAD onto a raw commit sha. */
async function detachHead(dir: string, sha: string): Promise<void> {
  await writeFile(path.join(dir, ".git", "HEAD"), `${sha}\n`);
}

/**
 * Fabricate an interrupted-rebase on-disk state.
 * Creates `<gitDir>/<backend>/` with orig-head (pre-rebase sha) and head-name.
 */
async function fabricateRebase(
  dir: string,
  origSha: string | undefined,
  opts: { backend?: "rebase-merge" | "rebase-apply"; headName?: string | null } = {},
): Promise<string> {
  const backend = opts.backend ?? "rebase-merge";
  const stateDir = path.join(dir, ".git", backend);
  await mkdir(stateDir, { recursive: true });
  if (origSha) await writeFile(path.join(stateDir, "orig-head"), `${origSha}\n`);
  if (opts.headName !== null) {
    await writeFile(path.join(stateDir, "head-name"), `${opts.headName ?? "refs/heads/main"}\n`);
  }
  return stateDir;
}

function hasRebaseMarkers(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, ".git", "rebase-merge")) ||
    fs.existsSync(path.join(dir, ".git", "rebase-apply"))
  );
}

// ── recovered path ────────────────────────────────────────────────────────────

describe("recover interrupted_rebase — recovered", () => {
  test("rebase-merge backend: rewinds branch to orig sha, re-attaches HEAD, clears markers", async () => {
    const dir = await makeTempDir("ir-recovered-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir); // second commit sha
    // Simulate mid-rebase: HEAD detached at the tip, markers present, orig=first.
    await fabricateRebase(dir, firstSha);
    await detachHead(dir, tip);
    // Dirty the working tree (in-progress replay edit).
    await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nHALF-APPLIED.\n");

    expect(await currentBranch(dir)).toBeUndefined();

    const result = await recover(makeCtx(dir));

    expect(result.status).toBe("recovered");
    expect(hasRebaseMarkers(dir)).toBe(false);
    expect(await currentBranch(dir)).toBe("main");
    expect(await resolveMain(dir)).toBe(firstSha);

    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath).toBeTruthy();
    await expect(assertZipReadable(r.backupZipPath!)).resolves.toBeUndefined();
  });

  test("rebase-apply backend also clears markers and recovers", async () => {
    const dir = await makeTempDir("ir-apply-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    await fabricateRebase(dir, firstSha, { backend: "rebase-apply" });
    await detachHead(dir, tip);

    const result = await recover(makeCtx(dir));

    expect(result.status).toBe("recovered");
    expect(hasRebaseMarkers(dir)).toBe(false);
    expect(await currentBranch(dir)).toBe("main");
    expect(await resolveMain(dir)).toBe(firstSha);
  });

  test("falls back to ctx.branch + ORIG_HEAD when state files are absent", async () => {
    const dir = await makeTempDir("ir-fallback-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    // Marker dir with NO orig-head / head-name; rely on ORIG_HEAD + ctx.branch.
    await fabricateRebase(dir, undefined, { headName: null });
    await writeFile(path.join(dir, ".git", "ORIG_HEAD"), `${firstSha}\n`);
    await detachHead(dir, tip);

    const result = await recover(makeCtx(dir, { branch: "main" }));

    expect(result.status).toBe("recovered");
    expect(await resolveMain(dir)).toBe(firstSha);
  });

  test("rebase started from detached HEAD (sentinel head-name): restores detached to orig sha, no bogus branch ref", async () => {
    const dir = await makeTempDir("ir-detached-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    // Native git writes a sentinel (e.g. "detached HEAD"), NOT a refs/heads/ path,
    // when the rebase itself was started from a detached HEAD.
    await fabricateRebase(dir, firstSha, { headName: "detached HEAD" });
    await detachHead(dir, tip);

    const result = await recover(makeCtx(dir, { branch: "main" }));

    expect(result.status).toBe("recovered");
    expect(hasRebaseMarkers(dir)).toBe(false);
    // HEAD is restored DETACHED at the pre-rebase commit — still no branch.
    expect(await currentBranch(dir)).toBeUndefined();
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(firstSha);
    // main must NOT have been moved onto the pre-rebase commit (it stays at tip).
    expect(await resolveMain(dir)).toBe(tip);
    // No bogus `refs/heads/detached HEAD` ref was created.
    const branches = await git.listBranches({ fs, dir });
    expect(branches).not.toContain("detached HEAD");
  });
});

// ── DENY ──────────────────────────────────────────────────────────────────────

describe("recover interrupted_rebase — confirmation denied", () => {
  test("DENY → blocked, markers still present, branch unchanged", async () => {
    const dir = await makeTempDir("ir-deny-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    await fabricateRebase(dir, firstSha);
    await detachHead(dir, tip);

    const result = await recover(makeCtx(dir, { confirmation: DENY }));

    expect(result.status).toBe("blocked");
    expect(hasRebaseMarkers(dir)).toBe(true);
    // Branch ref untouched (still the tip, not rewound).
    expect(await resolveMain(dir)).toBe(tip);
    expect(await currentBranch(dir)).toBeUndefined();
  });
});

// ── Safety: backup_create fault ─────────────────────────────────────────────────

describe("recover interrupted_rebase — backup_create fault", () => {
  test("fault at backup_create → failed_no_changes_made, no writes", async () => {
    const dir = await makeTempDir("ir-backupfault-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    await fabricateRebase(dir, firstSha);
    await detachHead(dir, tip);

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
    expect(hasRebaseMarkers(dir)).toBe(true);
    expect(await resolveMain(dir)).toBe(tip);
  });
});

// ── Safety: mid-repair fault ────────────────────────────────────────────────────

describe("recover interrupted_rebase — mid-repair fault", () => {
  test("fault at checkout_branch → failed_backup_available, backup readable", async () => {
    const dir = await makeTempDir("ir-midfault-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    await fabricateRebase(dir, firstSha);
    await detachHead(dir, tip);

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

  test("unresolvable orig-head → failed_backup_available", async () => {
    const dir = await makeTempDir("ir-noorig-");
    await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    // No orig-head, no ORIG_HEAD → the pre-rebase sha cannot be resolved.
    await fabricateRebase(dir, undefined, { headName: null });
    await detachHead(dir, tip);

    const result = await recover(makeCtx(dir, { branch: "main" }));

    expect(result.status).toBe("failed_backup_available");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });
});

// ── TOCTOU: marker vanished before recovery ─────────────────────────────────────
//
// This precondition is now enforced by the DISPATCHER's `stillApplies` probe
// (dispatch.ts), INSIDE withRepoLock, before the bare handler is ever invoked
// — so this test goes through dispatch.recover, not the bare `recover()`
// export (the shared abort skeleton no longer has its own copy of this guard).

describe("recover interrupted_rebase — marker vanished before recovery", () => {
  test("no rebase marker → no-op recovered; branch NOT rewound off stale ORIG_HEAD, no backup/confirm", async () => {
    const { recover: dispatchRecover } = await import("./dispatch.ts");
    const dir = await makeTempDir("ir-vanished-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    // The rebase was finished/aborted externally between inspect and recover: NO
    // rebase-merge/rebase-apply marker. A STALE ORIG_HEAD from an unrelated op
    // points at the old first commit — the handler must NOT use it to rewind.
    await writeFile(path.join(dir, ".git", "ORIG_HEAD"), `${firstSha}\n`);

    let confirmCalled = false;
    const gate: ConfirmationGate = {
      confirmRepair: async () => {
        confirmCalled = true;
        return true;
      },
    };

    const result = await dispatchRecover("interrupted_rebase", makeCtx(dir, { confirmation: gate }));

    expect(result.status).toBe("recovered");
    // No destructive path was entered: no confirmation prompt, no backup.
    expect(confirmCalled).toBe(false);
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath ?? "").toBe("");
    // The branch was NOT rewound to the stale ORIG_HEAD; HEAD stays attached at tip.
    expect(await resolveMain(dir)).toBe(tip);
    expect(await currentBranch(dir)).toBe("main");
  });
});

// ── Repo-lock serialization (dispatcher-level, via policy serializeRepo) ───────

describe("recover interrupted_rebase — runs under the per-repo lock", () => {
  test("a competing repo op on the same dir waits until recovery releases the lock", async () => {
    // The lock is acquired by the DISPATCHER (policy serializeRepo), so this
    // test goes through dispatch.recover — not the bare handler.
    const { recover: dispatchRecover } = await import("./dispatch.ts");
    const dir = await makeTempDir("ir-lock-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    await fabricateRebase(dir, firstSha);
    await detachHead(dir, tip);

    const order: string[] = [];
    let releaseConfirm: (() => void) | undefined;
    // Confirmation gate that parks until we release it — this holds the recovery
    // inside its withRepoLock critical section so we can observe ordering.
    const gate: ConfirmationGate = {
      confirmRepair: () =>
        new Promise<boolean>((resolve) => {
          order.push("recovery-holding-lock");
          releaseConfirm = () => resolve(true);
        }),
    };

    // recover() synchronously registers itself in the per-repo queue before it
    // returns, so a withRepoLock() call issued right after is guaranteed to queue
    // BEHIND it (same resolved dir → same FIFO chain).
    const recoveryPromise = dispatchRecover(
      "interrupted_rebase",
      makeCtx(dir, { confirmation: gate }),
    );
    const competing = withRepoLock(dir, async () => {
      order.push("competing-ran");
    });

    // Give the event loop time; the competing op must NOT have run — recovery
    // still holds the lock (parked in confirmRepair).
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["recovery-holding-lock"]);
    expect(releaseConfirm).toBeDefined();

    releaseConfirm!();
    const result = await recoveryPromise;
    await competing;

    expect(result.status).toBe("recovered");
    // The competing op ran only AFTER recovery released the lock.
    expect(order).toEqual(["recovery-holding-lock", "competing-ran"]);
  });
});

// ── Author-facing copy discipline ───────────────────────────────────────────────

describe("recover interrupted_rebase — copy discipline", () => {
  test("blocked guidance userSummary has no git jargon", async () => {
    const dir = await makeTempDir("ir-copy-");
    const { firstSha } = await initTwoCommitRepo(dir);
    const tip = await resolveMain(dir);
    await fabricateRebase(dir, firstSha);
    await detachHead(dir, tip);

    const result = await recover(makeCtx(dir, { confirmation: DENY }));
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    const s = r.guidance.userSummary.toLowerCase();
    expect(s).not.toContain("rebase");
    expect(s).not.toContain("commit");
    expect(s).not.toContain("branch");
    expect(s).not.toContain("head");
    // But supportDetails (technical) MUST name the real state.
    expect(r.guidance.supportDetails).toContain("Interrupted rebase detected");
    expect(r.guidance.supportDetails).toContain("interrupted_rebase");
  });
});
