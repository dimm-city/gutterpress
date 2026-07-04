/**
 * Tests for abort-interrupted-operation.ts — the shared skeleton the three
 * recover-interrupted-* handlers delegate to.
 *
 * These assert the parameterized invariants directly (the per-handler tests
 * cover the concrete configs):
 *   - TOCTOU: NONE of markerFiles present → benign no-op recovered, no backup,
 *     no confirmation, worktree untouched.
 *   - Default branch resolution: ctx.branch → git.currentBranch → "HEAD".
 *   - hadLocalChanges is captured and passed to successMessage.
 *   - Marker-gone verification: if cleanup leaves a marker behind → the callback
 *     throws → failed_backup_available.
 *   - Custom resolveTarget with writeRefBranch rewinds a named branch ref.
 *   - resolveTarget throwing → failed_backup_available (backup is safe).
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
import {
  abortInterruptedOperation,
  type AbortConfig,
} from "./abort-interrupted-operation.ts";
import type {
  ConfirmationGate,
  FaultPoint,
  RecoveryContext,
  RecoveryResult,
} from "./types.ts";

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

/** Commit `filename` with `body` on the current branch, return the new sha. */
async function commitFile(dir: string, filename: string, body: string): Promise<string> {
  await writeFile(path.join(dir, filename), body);
  await git.add({ fs, dir, filepath: filename });
  return git.commit({ fs, dir, message: `add ${filename}`, author: AUTHOR });
}

/** Two-commit repo on main; returns { firstSha, secondSha (tip) }. */
async function initTwoCommitRepo(dir: string): Promise<{ firstSha: string; secondSha: string }> {
  await git.init({ fs, dir, defaultBranch: "main" });
  const firstSha = await commitFile(dir, "chapter-01.md", "# Chapter One\n\nOriginal.\n");
  const secondSha = await commitFile(dir, "chapter-02.md", "# Chapter Two\n\nSecond.\n");
  return { firstSha, secondSha };
}

/** A generic marker file inside .git that signals the interrupted state. */
const MARKER = "TEST_OP_HEAD";

function markerPath(dir: string): string {
  return path.join(dir, ".git", MARKER);
}

function fabricateMarker(dir: string, body = "\n"): void {
  fs.writeFileSync(markerPath(dir), body);
}

function markerPresent(dir: string): boolean {
  return fs.existsSync(markerPath(dir));
}

/** Minimal config using the DEFAULT branch resolution. */
function baseConfig(overrides: Partial<AbortConfig> = {}): AbortConfig {
  return {
    kind: "interrupted_merge",
    markerFiles: [MARKER],
    cleanupFiles: [MARKER],
    successMessage: (had) => (had ? "reset-with-edits" : "reset-clean"),
    ...overrides,
  };
}

// ── TOCTOU: marker vanished before recovery ─────────────────────────────────────

describe("abortInterruptedOperation — marker vanished", () => {
  test("no marker → no-op recovered; no backup, no confirm, worktree preserved", async () => {
    const dir = await makeTempDir("aio-vanished-");
    await initTwoCommitRepo(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "LOCAL EDIT — keep me\n");

    let confirmCalled = false;
    const gate: ConfirmationGate = {
      confirmRepair: async () => {
        confirmCalled = true;
        return true;
      },
    };

    const result = await abortInterruptedOperation(
      makeCtx(dir, { confirmation: gate }),
      baseConfig(),
    );

    expect(result.status).toBe("recovered");
    expect(confirmCalled).toBe(false);
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath ?? "").toBe("");
    expect(fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8")).toBe(
      "LOCAL EDIT — keep me\n",
    );
  });

  test("any-of markerFiles present is enough to proceed", async () => {
    const dir = await makeTempDir("aio-anyof-");
    await initTwoCommitRepo(dir);
    // Only the second marker exists.
    fs.writeFileSync(path.join(dir, ".git", "OTHER_MARK"), "\n");

    const result = await abortInterruptedOperation(
      makeCtx(dir),
      baseConfig({ markerFiles: [MARKER, "OTHER_MARK"], cleanupFiles: ["OTHER_MARK"] }),
    );

    expect(result.status).toBe("recovered");
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    // A destructive path WAS entered (backup created).
    expect(r.backupZipPath).toBeTruthy();
  });
});

// ── Default branch resolution: ctx.branch → currentBranch → "HEAD" ───────────────

describe("abortInterruptedOperation — default branch resolution", () => {
  test("uses ctx.branch when set; resets current branch, keeps HEAD attached", async () => {
    const dir = await makeTempDir("aio-ctxbranch-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);
    // Half-applied edit that must be reset.
    await writeFile(path.join(dir, "chapter-01.md"), "HALF-APPLIED\n");

    const result = await abortInterruptedOperation(makeCtx(dir, { branch: "main" }), baseConfig());

    expect(result.status).toBe("recovered");
    expect(markerPresent(dir)).toBe(false);
    expect(await currentBranch(dir)).toBe("main");
    expect(fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8")).toBe(
      "# Chapter One\n\nOriginal.\n",
    );
  });

  test("falls back to git.currentBranch when ctx.branch is empty", async () => {
    const dir = await makeTempDir("aio-currentbranch-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "HALF-APPLIED\n");

    const result = await abortInterruptedOperation(makeCtx(dir, { branch: "" }), baseConfig());

    expect(result.status).toBe("recovered");
    expect(await currentBranch(dir)).toBe("main");
    expect(fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8")).toBe(
      "# Chapter One\n\nOriginal.\n",
    );
  });

  test("falls back to checking out HEAD when detached and ctx.branch empty", async () => {
    const dir = await makeTempDir("aio-headfallback-");
    const { firstSha } = await initTwoCommitRepo(dir);
    fabricateMarker(dir);
    // Detach HEAD onto the first commit, then dirty the worktree.
    await writeFile(path.join(dir, ".git", "HEAD"), `${firstSha}\n`);
    await writeFile(path.join(dir, "chapter-01.md"), "HALF-APPLIED\n");

    const result = await abortInterruptedOperation(makeCtx(dir, { branch: "" }), baseConfig());

    expect(result.status).toBe("recovered");
    // HEAD stays detached at firstSha; worktree reset to that commit's content.
    expect(await currentBranch(dir)).toBeUndefined();
    expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(firstSha);
    expect(fs.existsSync(path.join(dir, "chapter-02.md"))).toBe(false);
  });
});

// ── hadLocalChanges capture ─────────────────────────────────────────────────────

describe("abortInterruptedOperation — hadLocalChanges capture", () => {
  test("dirty worktree → successMessage(true)", async () => {
    const dir = await makeTempDir("aio-dirty-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "DIRTY\n");

    let received: boolean | undefined;
    const result = await abortInterruptedOperation(
      makeCtx(dir),
      baseConfig({
        successMessage: (had) => {
          received = had;
          return "ok";
        },
      }),
    );

    expect(result.status).toBe("recovered");
    expect(received).toBe(true);
    expect((result as Extract<RecoveryResult, { status: "recovered" }>).message).toBe("ok");
  });

  test("clean worktree → successMessage(false)", async () => {
    const dir = await makeTempDir("aio-clean-");
    await initTwoCommitRepo(dir);
    // Marker present but no tracked-file edits.
    fabricateMarker(dir);

    let received: boolean | undefined;
    const result = await abortInterruptedOperation(
      makeCtx(dir),
      baseConfig({
        successMessage: (had) => {
          received = had;
          return "ok";
        },
      }),
    );

    expect(result.status).toBe("recovered");
    expect(received).toBe(false);
  });
});

// ── Marker-gone verification ─────────────────────────────────────────────────────

describe("abortInterruptedOperation — marker-gone verification", () => {
  test("marker survives cleanup → throws → failed_backup_available", async () => {
    const dir = await makeTempDir("aio-notcleared-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);

    // cleanupFiles omits the marker, so it is still present after "cleanup".
    const result = await abortInterruptedOperation(
      makeCtx(dir),
      baseConfig({ cleanupFiles: [] }),
    );

    expect(result.status).toBe("failed_backup_available");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });
});

// ── Custom resolveTarget: rewind a named branch ref ─────────────────────────────

describe("abortInterruptedOperation — custom resolveTarget", () => {
  test("writeRefBranch rewinds the branch ref before checkout", async () => {
    const dir = await makeTempDir("aio-rewind-");
    const { firstSha, secondSha } = await initTwoCommitRepo(dir);
    expect(await resolveMain(dir)).toBe(secondSha);
    fabricateMarker(dir);

    const result = await abortInterruptedOperation(
      makeCtx(dir),
      baseConfig({
        resolveTarget: async () => ({
          checkoutRef: "main",
          writeRefBranch: "main",
          writeRefValue: firstSha,
        }),
      }),
    );

    expect(result.status).toBe("recovered");
    expect(await resolveMain(dir)).toBe(firstSha);
    expect(await currentBranch(dir)).toBe("main");
  });

  test("resolveTarget throwing → failed_backup_available (backup safe)", async () => {
    const dir = await makeTempDir("aio-resolvethrow-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);

    const result = await abortInterruptedOperation(
      makeCtx(dir),
      baseConfig({
        resolveTarget: async () => {
          throw new Error("cannot resolve target");
        },
      }),
    );

    expect(result.status).toBe("failed_backup_available");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
    // The marker is untouched (we threw before the destructive section).
    expect(markerPresent(dir)).toBe(true);
  });
});

// ── DENY + backup_create fault (shared gate wiring) ─────────────────────────────

describe("abortInterruptedOperation — gate wiring", () => {
  test("DENY → blocked, marker still present", async () => {
    const dir = await makeTempDir("aio-deny-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);

    const result = await abortInterruptedOperation(
      makeCtx(dir, { confirmation: DENY }),
      baseConfig(),
    );

    expect(result.status).toBe("blocked");
    expect(markerPresent(dir)).toBe(true);
  });

  test("backup_create fault → failed_no_changes_made, marker present", async () => {
    const dir = await makeTempDir("aio-backupfault-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);

    const result = await abortInterruptedOperation(
      makeCtx(dir, {
        faults: {
          before: async (p: FaultPoint) => {
            if (p === "backup_create") throw new Error("disk full");
          },
        },
      }),
      baseConfig(),
    );

    expect(result.status).toBe("failed_no_changes_made");
    expect(markerPresent(dir)).toBe(true);
  });

  test("checkout_branch fault → failed_backup_available", async () => {
    const dir = await makeTempDir("aio-midfault-");
    await initTwoCommitRepo(dir);
    fabricateMarker(dir);

    const result = await abortInterruptedOperation(
      makeCtx(dir, {
        faults: {
          before: async (p: FaultPoint) => {
            if (p === "checkout_branch") throw new Error("checkout failed");
          },
        },
      }),
      baseConfig(),
    );

    expect(result.status).toBe("failed_backup_available");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });
});
