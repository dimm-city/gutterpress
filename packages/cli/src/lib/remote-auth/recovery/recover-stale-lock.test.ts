/**
 * Tests for recover-stale-lock.ts — stale .git/index.lock removal.
 *
 * WHY: A stale index.lock is left behind when a git operation dies mid-way
 * (power loss, forced kill, crash). isomorphic-git refuses to write the
 * index while the lock exists, so every subsequent operation fails until
 * the lock is removed. This handler automates that cleanup with a user
 * confirmation gate.
 *
 * Key spec behaviours under test:
 *   FRESH LOCK  (age ≤ threshold, e.g. 5 s) → retry_later; lock STILL EXISTS
 *   STALE LOCK  (age ≥ threshold, e.g. 10 min) → confirm → delete → recovered;
 *               lock FILE MISSING after success
 *   DENY        confirmation → blocked; lock REMAINS; local + remote UNCHANGED
 *   FAULT at remove_index_lock → failed_backup_available / failed_no_changes_made;
 *               remote UNCHANGED
 *   No force-push: push spy must never see force=true on any call.
 *   No backup (policy.createBackup = false for stale_lock).
 *
 * Uses real on-disk temp repos (isomorphic-git). Mocks: confirmation gate,
 * FaultInjector, push spy (httpClient wrapper). Never shells out to system git.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { makeTempDir as freshTempDir, makeTestRepo } from "../../../test-helpers/testkit";

import { gitDirFor } from "../../source-provider.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  FaultPoint,
  ConfirmationGate,
} from "./types.ts";
import { recover } from "./recover-stale-lock.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The threshold (in ms) below which a lock is considered "fresh" (possibly
 * still held by a live process). The handler must expose this or we derive it
 * from observable behaviour. We use 2 minutes as the conservative spec value.
 */
const FRESH_LOCK_AGE_MS = 5_000;      // 5 s  → should be retry_later
const STALE_LOCK_AGE_MS = 10 * 60_000; // 10 min → should be recoverable

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return freshTempDir("stale-lock-test-");
}

/**
 * Create a lock file at .git/index.lock with a given age (via mtime).
 * `ageMs` is how old the lock should appear to be from `now`.
 */
async function placeLockFile(repoDir: string, ageMs: number, now: number): Promise<string> {
  const lockPath = path.join(gitDirFor(repoDir), "index.lock");
  await writeFile(lockPath, "lock\n");
  // Set mtime so the file appears to be `ageMs` old at `now`.
  const mtimeSecs = (now - ageMs) / 1000;
  await utimes(lockPath, mtimeSecs, mtimeSecs);
  return lockPath;
}

/**
 * Create a lock file at an arbitrary path UNDER .git (e.g. "HEAD.lock" or
 * "refs/heads/main.lock"), creating any missing parent directories, and age it
 * via mtime exactly like {@link placeLockFile}.
 */
async function placeNamedLock(
  repoDir: string,
  relUnderGit: string,
  ageMs: number,
  now: number,
): Promise<string> {
  const lockPath = path.join(gitDirFor(repoDir), ...relUnderGit.split("/"));
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, "lock\n");
  const mtimeSecs = (now - ageMs) / 1000;
  await utimes(lockPath, mtimeSecs, mtimeSecs);
  return lockPath;
}

/** Build a RecoveryContext for a test repo. */
function makeCtx(
  repoDir: string,
  nowMs: number,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: repoDir,
    repoDir,
    branch: "main",
    repoSlug: "test-book",
    confirmation: {
      confirmRepair: async () => true, // default: approve
    },
    now: () => nowMs,
    ...overrides,
  };
}

/** Confirm-gate that always denies. */
const denyGate: ConfirmationGate = {
  confirmRepair: async () => false,
};

// ── Fresh lock → retry_later ──────────────────────────────────────────────────

describe("recover-stale-lock — fresh lock (age < threshold)", () => {
  test("returns retry_later when lock is only 5 seconds old", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, FRESH_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("retry_later");
  });

  test("lock file STILL EXISTS after retry_later result", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeLockFile(dir, FRESH_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    await recover(ctx);

    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test("retry_later includes a positive retryAfterMs", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, FRESH_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "retry_later" }>;
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });
});

// ── No lock at all → retry_later or a safe no-op ─────────────────────────────

describe("recover-stale-lock — no lock file present", () => {
  test("returns retry_later when there is no lock file", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    // Do NOT create a lock file — the handler must not crash.
    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    // No lock → treat as freshly-gone (race won by the other process); safe to retry.
    expect(result.status).toBe("retry_later");
  });
});

// ── Stale lock → confirm → recovered ─────────────────────────────────────────

describe("recover-stale-lock — stale lock success path", () => {
  test("returns recovered for a 10-minute-old lock when user approves", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
  });

  test("lock file is ABSENT after successful removal", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    await recover(ctx);

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("recovered result has a non-empty message", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.message.length).toBeGreaterThan(0);
  });

  test("user file chapter-01.md is preserved after successful removal", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    await recover(ctx);

    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe("# Chapter One\n\nContent.\n");
  });

  test("confirmation is requested with the correct kind and risk metadata", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    let capturedReq: Parameters<ConfirmationGate["confirmRepair"]>[0] | undefined;

    const ctx = makeCtx(dir, nowMs, {
      confirmation: {
        confirmRepair: async (req) => {
          capturedReq = req;
          return true;
        },
      },
    });

    await recover(ctx);

    expect(capturedReq).toBeDefined();
    expect(capturedReq!.repair).toBe("stale_lock");
    expect(capturedReq!.risk).toBe("low");
    // stale_lock policy: no local files changed, only git metadata
    expect(capturedReq!.willChangeLocalFiles).toBe(false);
    expect(capturedReq!.willChangeGitMetadata).toBe(true);
    expect(capturedReq!.willChangeRemote).toBe(false);
  });

  test("no backup zip is created for stale_lock (policy.createBackup=false)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    // Policy has createBackup=false; recovered result must not reference a zip.
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath).toBeUndefined();
  });
});

// ── DENY confirmation → blocked ───────────────────────────────────────────────

describe("recover-stale-lock — user denies confirmation", () => {
  test("returns blocked when user denies", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");
  });

  test("lock file REMAINS when user denies", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    await recover(ctx);

    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test("user file chapter-01.md is unchanged when user denies", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    await recover(ctx);

    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe("# Chapter One\n\nContent.\n");
  });

  test("blocked result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    const result = await recover(ctx);

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
  });

  test("blocked result has no backupZipPath (no backup for stale_lock)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    const result = await recover(ctx);

    // stale_lock policy has createBackup=false, so no zip is created.
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(r.backupZipPath).toBeUndefined();
  });
});

// ── SAFETY: no force-push invariant ──────────────────────────────────────────

describe("recover-stale-lock — no force-push safety invariant", () => {
  test("does not call httpClient push at all (stale_lock is local-only)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const pushCalls: Array<{ url: string; headers: Record<string, string>; body: AsyncIterableIterator<Uint8Array> }> = [];

    // Wrap a spy around a no-op http client.
    const spyHttpClient = {
      request: async (params: { url: string; headers: Record<string, string>; body: AsyncIterableIterator<Uint8Array> }) => {
        pushCalls.push(params);
        return {
          url: params.url,
          method: "POST",
          headers: {},
          body: (async function* () {})(),
          statusCode: 200,
          statusMessage: "OK",
        };
      },
    } as unknown as Parameters<typeof recover>[0]["httpClient"];

    const ctx = makeCtx(dir, nowMs, { httpClient: spyHttpClient });
    await recover(ctx);

    // Stale lock removal is purely local; no push should ever be made.
    expect(pushCalls.length).toBe(0);
  });
});

// ── SAFETY: fault at remove_index_lock ───────────────────────────────────────

describe("recover-stale-lock — fault injection at remove_index_lock", () => {
  test("returns failed_no_changes_made when remove_index_lock fault fires", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index_lock") throw new Error("injected: fs.unlink failed");
        },
      },
    });

    const result = await recover(ctx);

    // No backup for stale_lock (policy.createBackup=false), so when the repair
    // fails the result is failed_no_changes_made.
    expect(result.status).toBe("failed_no_changes_made");
  });

  test("failed_no_changes_made result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index_lock") throw new Error("injected: permission denied");
        },
      },
    });

    const result = await recover(ctx);

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "failed_no_changes_made" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
  });

  test("user file is preserved when remove_index_lock fault fires", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index_lock") throw new Error("injected: cannot delete");
        },
      },
    });

    await recover(ctx);

    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe("# Chapter One\n\nContent.\n");
  });
});

// ── SAFETY: guidance strings must not leak git internals ─────────────────────

describe("recover-stale-lock — author-facing copy rules", () => {
  const GIT_WORDS = /\b(index\.lock|\.git|HEAD|ref|rebase|branch|commit|hash|sha|oid)\b/i;

  test("retry_later message has no git jargon", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, FRESH_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "retry_later" }>;
    expect(GIT_WORDS.test(r.message)).toBe(false);
  });

  test("blocked guidance.userSummary has no git jargon", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(GIT_WORDS.test(r.guidance.userSummary)).toBe(false);
  });

  test("failed_no_changes_made guidance.userSummary has no git jargon", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index_lock") throw new Error("injected");
        },
      },
    });

    const result = await recover(ctx);

    const r = result as Extract<RecoveryResult, { status: "failed_no_changes_made" }>;
    expect(GIT_WORDS.test(r.guidance.userSummary)).toBe(false);
  });
});

// ── Boundary: lock age exactly at threshold ───────────────────────────────────

describe("recover-stale-lock — lock age boundary", () => {
  /**
   * The spec says: fresh lock → retry_later; stale lock → can be removed.
   * We pick 2 minutes as the canonical threshold. The test drives the handler
   * with a lock that is exactly 1 ms younger and 1 ms older than the threshold
   * and asserts the direction of the decision.
   *
   * The implementation is free to choose any threshold between 2 min and 10 min
   * — the tests use extremes well outside that band (5 s and 10 min) to avoid
   * a brittle boundary. This group tests that the boundary exists somewhere
   * between 30 s and 10 min.
   */

  test("lock age 30 seconds → retry_later", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, 30_000, nowMs); // 30 s

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("retry_later");
  });

  test("lock age 10 minutes → confirmed removal → recovered", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs); // 10 min

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
  });
});

// ── BUG 3: lock files BEYOND index.lock ───────────────────────────────────────
//
// A crash can leave HEAD.lock, config.lock, packed-refs.lock, or a per-branch
// refs/heads/<name>.lock behind. The handler must detect and (after the same
// age check + confirmation) remove these too, not only index.lock.

describe("recover-stale-lock — BUG 3: HEAD.lock", () => {
  test("a stale HEAD.lock is removed and recovery succeeds", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeNamedLock(dir, "HEAD.lock", STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("a stale config.lock is removed and recovery succeeds", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeNamedLock(dir, "config.lock", STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("a stale packed-refs.lock is removed and recovery succeeds", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeNamedLock(dir, "packed-refs.lock", STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("recover-stale-lock — BUG 3: refs/heads/<branch>.lock", () => {
  test("a stale refs/heads/main.lock is removed and recovery succeeds", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeNamedLock(
      dir,
      "refs/heads/main.lock",
      STALE_LOCK_AGE_MS,
      nowMs,
    );

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("user file chapter-01.md is preserved when a branch lock is removed", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeNamedLock(dir, "refs/heads/main.lock", STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    await recover(ctx);

    const content = fs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe("# Chapter One\n\nContent.\n");
  });
});

describe("recover-stale-lock — BUG 3: a fresh non-index lock blocks removal", () => {
  test("a fresh HEAD.lock returns retry_later and is NOT deleted", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeNamedLock(dir, "HEAD.lock", FRESH_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("retry_later");
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test("a fresh refs/heads/main.lock returns retry_later and is NOT deleted", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const lockPath = await placeNamedLock(
      dir,
      "refs/heads/main.lock",
      FRESH_LOCK_AGE_MS,
      nowMs,
    );

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("retry_later");
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test("when a stale HEAD.lock coexists with a FRESH index.lock, nothing is deleted", async () => {
    // Mixed ages: one stale, one fresh. A fresh lock means a live process may
    // still hold the repo, so the handler must NOT delete ANY lock yet.
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const staleHead = await placeNamedLock(dir, "HEAD.lock", STALE_LOCK_AGE_MS, nowMs);
    const freshIndex = await placeLockFile(dir, FRESH_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("retry_later");
    expect(fs.existsSync(staleHead)).toBe(true);
    expect(fs.existsSync(freshIndex)).toBe(true);
  });
});

describe("recover-stale-lock — BUG 3: multiple stale locks", () => {
  test("removes index.lock AND HEAD.lock AND refs/heads/main.lock together", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const indexLock = await placeLockFile(dir, STALE_LOCK_AGE_MS, nowMs);
    const headLock = await placeNamedLock(dir, "HEAD.lock", STALE_LOCK_AGE_MS, nowMs);
    const branchLock = await placeNamedLock(
      dir,
      "refs/heads/main.lock",
      STALE_LOCK_AGE_MS,
      nowMs,
    );

    const ctx = makeCtx(dir, nowMs);
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    expect(fs.existsSync(indexLock)).toBe(false);
    expect(fs.existsSync(headLock)).toBe(false);
    expect(fs.existsSync(branchLock)).toBe(false);
  });

  test("DENY leaves every stale lock in place", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const headLock = await placeNamedLock(dir, "HEAD.lock", STALE_LOCK_AGE_MS, nowMs);
    const branchLock = await placeNamedLock(
      dir,
      "refs/heads/main.lock",
      STALE_LOCK_AGE_MS,
      nowMs,
    );

    const ctx = makeCtx(dir, nowMs, { confirmation: denyGate });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");
    expect(fs.existsSync(headLock)).toBe(true);
    expect(fs.existsSync(branchLock)).toBe(true);
  });

  test("non-index stale lock confirmation keeps the jargon-free stale_lock metadata", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    await placeNamedLock(dir, "HEAD.lock", STALE_LOCK_AGE_MS, nowMs);

    let capturedReq: Parameters<ConfirmationGate["confirmRepair"]>[0] | undefined;
    const ctx = makeCtx(dir, nowMs, {
      confirmation: {
        confirmRepair: async (req) => {
          capturedReq = req;
          return true;
        },
      },
    });
    await recover(ctx);

    expect(capturedReq).toBeDefined();
    expect(capturedReq!.repair).toBe("stale_lock");
    expect(capturedReq!.risk).toBe("low");
    expect(capturedReq!.willChangeLocalFiles).toBe(false);
    expect(capturedReq!.willChangeGitMetadata).toBe(true);
    expect(capturedReq!.willChangeRemote).toBe(false);
  });
});

describe("recover-stale-lock — BUG 3: fault injection still fail-safe for non-index locks", () => {
  test("fault at remove_index_lock leaves a HEAD.lock untouched and reports failure", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);

    const nowMs = Date.now();
    const headLock = await placeNamedLock(dir, "HEAD.lock", STALE_LOCK_AGE_MS, nowMs);

    const ctx = makeCtx(dir, nowMs, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index_lock") throw new Error("injected: cannot delete");
        },
      },
    });
    const result = await recover(ctx);

    expect(result.status).toBe("failed_no_changes_made");
    expect(fs.existsSync(headLock)).toBe(true);
  });
});
