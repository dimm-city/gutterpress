/**
 * Tests for failsafe.ts — withBackupGate invariants and failSafeNoRepair.
 *
 * WHY: withBackupGate() is the single enforcement point for the recovery
 * subsystem's most critical safety guarantees (CLAUDE.md invariant 5):
 *   (a) backup creation fails => status failed_no_changes_made, ZERO write/git
 *       ops afterward (risky callback never called)
 *   (b) confirmation DENIED => status blocked, no-op (risky callback never
 *       called; local files and any existing remote unchanged)
 *   (c) risky callback throws AFTER backup => status failed_backup_available
 *       with assertZipReadable(backupZipPath) succeeding and no remote push
 *   (d) happy path => risky result is returned with backupZipPath threaded through
 *
 * Uses REAL on-disk temp repos. Mocks used only for:
 *   - confirmation gate (UI dialog)
 *   - FaultInjector (controls which step fails)
 *
 * Never shells out to system git. Repo fixtures use isomorphic-git directly.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir as freshTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";

import { assertZipReadable, BACKUP_ROOT } from "./backup.ts";
import { withBackupGate, failSafeNoRepair } from "./failsafe.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  FaultPoint,
  SyncErrorKind,
} from "./types.ts";

// ── Temp dir helpers ──────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return freshTempDir("failsafe-test-");
}

/** Create a minimal git repo with at least one file so the zip is non-empty. */
async function makeTestRepo(dir: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nContent.\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  const author = { name: "Test Author", email: "test@test.local" };
  await git.commit({ fs, dir, message: "initial", author });
}

// ── Context builder ───────────────────────────────────────────────────────────

function makeCtx(
  repoDir: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: repoDir,
    repoDir,
    branch: "main",
    repoSlug: "test-book",
    confirmation: {
      confirmRepair: async () => true, // default: approved
    },
    now: () => new Date("2025-01-15T10:30:00.000Z").getTime(),
    ...overrides,
  };
}

// ── (a) Backup creation fails ─────────────────────────────────────────────────
//
// Policy for "detached_head" has createBackup: true and requireConfirmation: true.
// When backup_create throws, withBackupGate must:
//   - return status: "failed_no_changes_made"
//   - NEVER call the risky callback (write op counter must stay 0)

describe("withBackupGate — (a) fault at backup_create", () => {
  test("returns failed_no_changes_made when backup_create throws", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    let riskyCallCount = 0;

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await withBackupGate(
      ctx,
      "detached_head", // policy: createBackup=true, requireConfirmation=true
      async (_backupZipPath) => {
        riskyCallCount++;
        return { status: "recovered", message: "should not reach here" };
      },
    );

    expect(result.status).toBe("failed_no_changes_made");
    expect(riskyCallCount).toBe(0);
  });

  test("backup_create failure result has no backupZipPath", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await withBackupGate(
      ctx,
      "detached_head",
      async () => ({ status: "recovered", message: "should not reach" }),
    );

    // No backup was created — result must not reference a zip path.
    expect("backupZipPath" in result).toBe(false);
  });

  test("backup_create failure includes guidance for user", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await withBackupGate(
      ctx,
      "detached_head",
      async () => ({ status: "recovered", message: "should not reach" }),
    );

    // Must include ManualGuidance so host can show useful copy.
    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "failed_no_changes_made" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
  });
});

// ── (b) Confirmation DENIED ───────────────────────────────────────────────────
//
// Policy for "corrupt_index" has createBackup: true and requireConfirmation: true.
// When the user denies the confirmation:
//   - return status: "blocked"
//   - backupZipPath PRESENT (backup was already created before the prompt)
//   - risky callback NEVER called
//   - user files unchanged (chapter-01.md still readable with original content)

describe("withBackupGate — (b) confirmation DENIED", () => {
  test("returns blocked when user denies confirmation", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    let riskyCallCount = 0;

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false, // user denies
      },
    });

    const result = await withBackupGate(
      ctx,
      "corrupt_index", // policy: createBackup=true, requireConfirmation=true
      async (_backupZipPath) => {
        riskyCallCount++;
        return { status: "recovered", message: "should not reach here" };
      },
    );

    expect(result.status).toBe("blocked");
    expect(riskyCallCount).toBe(0);
  });

  test("blocked result includes a backupZipPath (backup was already created)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false,
      },
    });

    const result = await withBackupGate(
      ctx,
      "corrupt_index",
      async () => ({ status: "recovered", message: "should not reach" }),
    );

    // Backup was created BEFORE the confirmation prompt, so it's available.
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(r.backupZipPath).toBeDefined();
    expect(typeof r.backupZipPath).toBe("string");
    expect(r.backupZipPath!.length).toBeGreaterThan(0);
  });

  test("blocked result: backupZipPath is readable from disk", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false,
      },
    });

    const result = await withBackupGate(
      ctx,
      "corrupt_index",
      async () => ({ status: "recovered", message: "should not reach" }),
    );

    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    // The zip created for the prompt must be readable from disk.
    await expect(assertZipReadable(r.backupZipPath!)).resolves.toBeUndefined();
  });

  test("blocked result: user files are preserved unchanged", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const originalContent = "# Chapter One\n\nContent.\n";

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false,
      },
    });

    await withBackupGate(
      ctx,
      "corrupt_index",
      async () => ({ status: "recovered", message: "should not reach" }),
    );

    // User-visible files must be unchanged.
    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("blocked result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false,
      },
    });

    const result = await withBackupGate(
      ctx,
      "corrupt_index",
      async () => ({ status: "recovered", message: "should not reach" }),
    );

    expect(result).toHaveProperty("guidance");
  });
});

// ── (c) Risky callback throws AFTER backup ───────────────────────────────────
//
// The risky callback fires the after_backup_before_repair fault point, then throws.
// withBackupGate must:
//   - return status: "failed_backup_available"
//   - backupZipPath present and assertZipReadable() succeeds
//   - no force-push was attempted (risky callback never called push)

describe("withBackupGate — (c) risky callback throws after backup", () => {
  test("returns failed_backup_available when risky throws", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    // No confirmation required for missing_or_corrupt_objects we'd like
    // to test — pick a kind that has createBackup=true and requireConfirmation=true
    // but short-circuit confirmation (auto-approve).
    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => true, // approve
      },
    });

    const result = await withBackupGate(
      ctx,
      "missing_or_corrupt_objects", // createBackup=true, requireConfirmation=true
      async (_backupZipPath) => {
        throw new Error("injected: repair failed mid-way");
      },
    );

    expect(result.status).toBe("failed_backup_available");
  });

  test("failed_backup_available result has a readable zip on disk", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => true,
      },
    });

    const result = await withBackupGate(
      ctx,
      "missing_or_corrupt_objects",
      async (_backupZipPath) => {
        throw new Error("injected: repair exploded");
      },
    );

    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    expect(r.backupZipPath).toBeDefined();
    await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
  });

  test("failed_backup_available result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => true,
      },
    });

    const result = await withBackupGate(
      ctx,
      "missing_or_corrupt_objects",
      async () => {
        throw new Error("repair threw");
      },
    );

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
  });

  test("user files are preserved even when risky callback throws", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const originalContent = "# Chapter One\n\nContent.\n";

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => true,
      },
    });

    await withBackupGate(
      ctx,
      "missing_or_corrupt_objects",
      async () => {
        throw new Error("repair threw");
      },
    );

    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe(originalContent);
  });
});

// ── (d) Happy path ────────────────────────────────────────────────────────────
//
// When backup is created, confirmation is approved, and risky succeeds:
//   - the risky callback's result is returned
//   - backupZipPath is threaded through if the risky callback includes it

describe("withBackupGate — (d) happy path", () => {
  test("returns risky callback's result on success (no backup needed)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const ctx = makeCtx(dir);

    // "non_fast_forward" policy: createBackup=false, requireConfirmation=false
    const result = await withBackupGate(
      ctx,
      "non_fast_forward",
      async (_backupZipPath) => ({
        status: "recovered",
        message: "all good",
      }),
    );

    expect(result.status).toBe("recovered");
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.message).toBe("all good");
  });

  test("risky callback receives backupZipPath when backup was created", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    let receivedBackupPath: string | undefined = undefined;

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => true,
      },
    });

    // "detached_head" policy: createBackup=true, requireConfirmation=true
    await withBackupGate(
      ctx,
      "detached_head",
      async (backupZipPath) => {
        receivedBackupPath = backupZipPath;
        return { status: "recovered", message: "done", backupZipPath: backupZipPath ?? "" };
      },
    );

    expect(receivedBackupPath).toBeDefined();
    expect(typeof receivedBackupPath).toBe("string");
  });

  test("risky callback receives undefined backupZipPath when policy has no backup", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    let receivedBackupPath: string | undefined = "sentinel"; // start non-undefined

    const ctx = makeCtx(dir);

    // "network_unavailable" policy: createBackup=false, requireConfirmation=false
    await withBackupGate(
      ctx,
      "network_unavailable",
      async (backupZipPath) => {
        receivedBackupPath = backupZipPath;
        return { status: "retry_later", message: "retry", retryAfterMs: 30000 };
      },
    );

    expect(receivedBackupPath).toBeUndefined();
  });

  test("backupZipPath in result is readable from disk (happy path with backup)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    let capturedZipPath: string | undefined;

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => true,
      },
    });

    const result = await withBackupGate(
      ctx,
      "detached_head",
      async (backupZipPath) => {
        capturedZipPath = backupZipPath;
        return { status: "recovered", message: "done", backupZipPath: backupZipPath! };
      },
    );

    expect(result.status).toBe("recovered");
    expect(capturedZipPath).toBeDefined();
    await expect(assertZipReadable(capturedZipPath!)).resolves.toBeUndefined();
  });
});

// ── failSafeNoRepair unit tests ───────────────────────────────────────────────

describe("failSafeNoRepair", () => {
  test("returns failed_no_changes_made when no backup path given", () => {
    const result = failSafeNoRepair(
      { repoSlug: "test-book", remoteUrl: undefined },
      "unknown",
    );

    expect(result.status).toBe("failed_no_changes_made");
    expect(result).toHaveProperty("guidance");
  });

  test("returns failed_backup_available when backup path given", () => {
    const fakeZip = path.join(BACKUP_ROOT, "test-book", "fake.zip");
    const result = failSafeNoRepair(
      { repoSlug: "test-book", remoteUrl: undefined },
      "detached_head",
      fakeZip,
    );

    expect(result.status).toBe("failed_backup_available");
    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    expect(r.backupZipPath).toBe(fakeZip);
    expect(r.guidance).toBeDefined();
  });

  test("guidance backupZipPath matches the supplied path", () => {
    const zipPath = path.join(BACKUP_ROOT, "test-book", "fake.zip");
    const result = failSafeNoRepair(
      { repoSlug: "test-book", remoteUrl: undefined },
      "corrupt_index",
      zipPath,
    );

    const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
    expect(r.guidance.backupZipPath).toBe(zipPath);
  });

  test("all result statuses include non-empty guidance strings", () => {
    const kinds: SyncErrorKind[] = [
      "non_fast_forward", "merge_conflict", "auth_required",
      "network_unavailable", "detached_head", "stale_lock",
      "corrupt_index", "missing_git_dir", "unknown",
    ];
    for (const kind of kinds) {
      const result = failSafeNoRepair(
        { repoSlug: "test-book", remoteUrl: undefined },
        kind,
      );
      expect(result).toHaveProperty("guidance");
      const r = result as { guidance: { userSummary: string; recommendedAction: string } };
      expect(r.guidance.userSummary.length).toBeGreaterThan(0);
      expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
    }
  });
});
