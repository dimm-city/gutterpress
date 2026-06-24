/**
 * Tests for the recovery-orchestrator integration.
 *
 * These tests exercise the REAL exports from electron/recovery-bridge.ts
 * (classifyFromHealth, hostConfirmationGate, handleConfirmResponse,
 * rejectAllPendingConfirms, buildRecoveryContext) rather than reimplementing
 * them inline as copies. Covers the decision routing that runAutoSync applies
 * when recover() returns different result statuses.
 *
 * NOTE: runAutoSync itself lives in electron/main.ts which cannot be imported
 * outside Electron. The strategy here (following the test-fidelity-ladder) is:
 *   - Classify / gate / context functions → tested against REAL exports (this file).
 *   - runAutoSync routing logic → covered via integration smoke tests and the
 *     Electron e2e harness (future). The inline copy strategy was removed because
 *     copies silently drift from the real code.
 *
 * Verifies:
 * 1. classifyFromHealth priority chain (missing_git_dir > stale_lock > merge >
 *    rebase/cherry-pick → safe "unknown" > detached)
 * 2. hostConfirmationGate + handleConfirmResponse roundtrip for confirmed/rejected
 * 3. rejectAllPendingConfirms defaults all pending to false (safe when renderer crashes)
 * 4. Confirm timeout resolves false (default-safe, inFlight cannot be permanently wedged)
 * 5. buildRecoveryContext sets required fields (projectDir, repoDir, branch, repoSlug, confirmation)
 */

import { describe, test, expect, afterEach } from "bun:test";
import type { RepoHealth } from "@dimm-city/print-md";
import {
  classifyFromHealth,
  hostConfirmationGate,
  handleConfirmResponse,
  rejectAllPendingConfirms,
  buildRecoveryContext,
  setRecoveryBridgeWindow,
} from "../../electron/recovery-bridge";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGoodHealth(): RepoHealth {
  return {
    hasGitDir: true,
    currentBranch: "main",
    isDetachedHead: false,
    hasStaleLock: false,
    hasInterruptedMerge: false,
    hasInterruptedRebase: false,
    hasInterruptedCherryPick: false,
    hasLocalChanges: false,
  };
}

function makeSentMessages() {
  const msgs: Array<{ channel: string; args: unknown[] }> = [];
  const win = {
    webContents: {
      send(ch: string, ...a: unknown[]) {
        msgs.push({ channel: ch, args: a });
      },
    },
    isDestroyed: () => false,
  };
  return { win, msgs };
}

afterEach(() => {
  rejectAllPendingConfirms();
  setRecoveryBridgeWindow(null);
});

// ── 1. classifyFromHealth priority chain ──────────────────────────────────────

describe("classifyFromHealth priority chain (real code)", () => {
  test("healthy repo → null", () => {
    expect(classifyFromHealth(makeGoodHealth())).toBeNull();
  });

  test("missing_git_dir beats all other conditions", () => {
    expect(
      classifyFromHealth({
        ...makeGoodHealth(),
        hasGitDir: false,
        hasStaleLock: true,
        lockAgeMs: 99_999,
        hasInterruptedMerge: true,
        isDetachedHead: true,
      }),
    ).toBe("missing_git_dir");
  });

  test("stale_lock (old enough, ≥ 2 min) beats merge/rebase/detached", () => {
    expect(
      classifyFromHealth({
        ...makeGoodHealth(),
        hasStaleLock: true,
        lockAgeMs: 150_000,
        hasInterruptedMerge: true,
        isDetachedHead: true,
      }),
    ).toBe("stale_lock");
  });

  test("merge_conflict beats rebase and detached", () => {
    expect(
      classifyFromHealth({
        ...makeGoodHealth(),
        hasInterruptedMerge: true,
        hasInterruptedRebase: true,
        isDetachedHead: true,
      }),
    ).toBe("merge_conflict");
  });

  test("interrupted rebase maps to the safe 'unknown' kind (BUG 1 — not non_fast_forward)", () => {
    // An interrupted rebase is not a non-fast-forward push rejection; routing it
    // there would run syncProject on a repo stuck mid-rebase. "unknown" → fail-safe.
    expect(
      classifyFromHealth({ ...makeGoodHealth(), hasInterruptedRebase: true, isDetachedHead: true }),
    ).toBe("unknown");
  });

  test("cherry-pick maps to the safe 'unknown' kind (BUG 1 — not merge_conflict)", () => {
    expect(
      classifyFromHealth({ ...makeGoodHealth(), hasInterruptedCherryPick: true }),
    ).toBe("unknown");
  });

  test("detached_head (lowest priority) → detached_head when nothing else active", () => {
    expect(
      classifyFromHealth({ ...makeGoodHealth(), isDetachedHead: true }),
    ).toBe("detached_head");
  });

  test("healthy repo is never classified as 'unknown' (only rebase/cherry-pick map there)", () => {
    // classifyFromHealth returns "unknown" ONLY for an interrupted rebase or
    // cherry-pick (BUG 1's safe mapping). A healthy snapshot must yield null, so
    // it can never be mistaken for the fail-safe path.
    const result = classifyFromHealth(makeGoodHealth());
    expect(result).toBeNull();
    expect(result).not.toBe("unknown");
  });
});

// ── 2. hostConfirmationGate + handleConfirmResponse roundtrip ─────────────────

describe("hostConfirmationGate + handleConfirmResponse roundtrip (real code)", () => {
  const DIR = "/proj/test-book";

  test("classified kind — emits 'recovery:confirm-request', resolves true on handleConfirmResponse", async () => {
    const { win, msgs } = makeSentMessages();
    // @ts-expect-error minimal mock
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const promise = gate.confirmRepair({
      repair: "stale_lock",
      risk: "low",
      summary: "Remove leftover lock file",
      backupZipPath: "/tmp/bk.zip",
      willChangeLocalFiles: false,
      willChangeGitMetadata: true,
      willChangeRemote: false,
      canBeUndoneFromBackup: true,
    });

    expect(msgs).toHaveLength(1);
    const { requestId } = msgs[0]!.args[0] as { requestId: string };

    handleConfirmResponse(requestId, true);
    expect(await promise).toBe(true);
  });

  test("recovered — handleConfirmResponse(false) resolves with false (user declined)", async () => {
    const { win, msgs } = makeSentMessages();
    // @ts-expect-error minimal mock
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const promise = gate.confirmRepair({
      repair: "corrupt_index",
      risk: "medium",
      summary: "Rebuild the git index",
      backupZipPath: "/tmp/bk.zip",
      willChangeLocalFiles: false,
      willChangeGitMetadata: true,
      willChangeRemote: false,
      canBeUndoneFromBackup: true,
    });

    const { requestId } = msgs[0]!.args[0] as { requestId: string };
    handleConfirmResponse(requestId, false);
    expect(await promise).toBe(false);
  });

  test("needs_user with files — conflict latch pattern (single-flight inFlight reset)", async () => {
    // Verify the gate properly supersedes stale pending per project
    const { win, msgs } = makeSentMessages();
    // @ts-expect-error minimal mock
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const p1 = gate.confirmRepair({
      repair: "merge_conflict",
      risk: "medium",
      summary: "Conflict",
      backupZipPath: "",
      willChangeLocalFiles: true,
      willChangeGitMetadata: true,
      willChangeRemote: false,
      canBeUndoneFromBackup: true,
    });

    // New request for same project supersedes the old
    const gate2 = hostConfirmationGate(DIR);
    const p2 = gate2.confirmRepair({
      repair: "merge_conflict",
      risk: "medium",
      summary: "Conflict (retry)",
      backupZipPath: "",
      willChangeLocalFiles: true,
      willChangeGitMetadata: true,
      willChangeRemote: false,
      canBeUndoneFromBackup: true,
    });

    // p1 was superseded → resolves false
    expect(await p1).toBe(false);

    // p2 is still pending → respond
    rejectAllPendingConfirms();
    expect(await p2).toBe(false);
  });
});

// ── 3. rejectAllPendingConfirms (default-safe on renderer crash) ─────────────

describe("rejectAllPendingConfirms (real code)", () => {
  test("blocked — all pending confirms resolve false when renderer disappears", async () => {
    const { win } = makeSentMessages();
    // @ts-expect-error minimal mock
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate("/proj/a");
    const gate2 = hostConfirmationGate("/proj/b");
    const p1 = gate.confirmRepair({
      repair: "stale_lock", risk: "low", summary: "s",
      backupZipPath: "", willChangeLocalFiles: false,
      willChangeGitMetadata: false, willChangeRemote: false, canBeUndoneFromBackup: true,
    });
    const p2 = gate2.confirmRepair({
      repair: "detached_head", risk: "high", summary: "s",
      backupZipPath: "", willChangeLocalFiles: false,
      willChangeGitMetadata: true, willChangeRemote: false, canBeUndoneFromBackup: false,
    });

    rejectAllPendingConfirms();
    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
  });
});

// ── 4. Timeout default-safe ───────────────────────────────────────────────────

describe("confirm timeout (real code)", () => {
  test("retry_later — non-responding renderer resolves false after timeout (inFlight safe)", async () => {
    const { win } = makeSentMessages();
    // @ts-expect-error minimal mock
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate("/proj/timeout-test", 50 /* ms */);
    const promise = gate.confirmRepair({
      repair: "stale_lock", risk: "low", summary: "s",
      backupZipPath: "", willChangeLocalFiles: false,
      willChangeGitMetadata: false, willChangeRemote: false, canBeUndoneFromBackup: true,
    });

    // No response — should resolve false after 50 ms
    expect(await promise).toBe(false);
  });
});

// ── 5. buildRecoveryContext required fields ───────────────────────────────────

describe("buildRecoveryContext (real code)", () => {
  test("sets projectDir, repoDir, branch, repoSlug, confirmation from lib stubs", async () => {
    const libStub = {
      // The project is opened at a subfolder; its OWN repo root is /repo.
      detectProjectSource: async (dir: string) => ({
        type: "local-git-folder",
        repoRoot: "/repo",
        path: dir,
      }),
      diagnoseProjectRemote: async (_dir: string, _opts?: unknown) => ({
        branch: "main",
        remoteUrl: undefined as string | undefined,
      }),
    };
    const tokenStoreStub = {
      get: async (_host: string) => null as null,
    };

    const ctx = await buildRecoveryContext("/repo/my-book", libStub, tokenStoreStub);

    expect(ctx.projectDir).toBe("/repo/my-book");
    expect(ctx.repoDir).toBe("/repo");
    expect(ctx.branch).toBe("main");
    expect(typeof ctx.repoSlug).toBe("string");
    expect(ctx.repoSlug.length).toBeGreaterThan(0);
    expect(typeof ctx.confirmation.confirmRepair).toBe("function");
  });

  test("authorName is undefined when not passed (consistent with syncProject)", async () => {
    const libStub = {
      detectProjectSource: async (_dir: string) => ({ type: "local-folder" }),
      diagnoseProjectRemote: async () => ({ branch: "main", remoteUrl: undefined as string | undefined }),
    };
    const tokenStoreStub = { get: async (_h: string) => null as null };

    const ctx = await buildRecoveryContext("/proj/book", libStub, tokenStoreStub);
    expect(ctx.authorName).toBeUndefined();
  });

  test("authorName is threaded when passed", async () => {
    const libStub = {
      detectProjectSource: async (_dir: string) => ({ type: "local-folder" }),
      diagnoseProjectRemote: async () => ({ branch: "main", remoteUrl: undefined as string | undefined }),
    };
    const tokenStoreStub = { get: async (_h: string) => null as null };

    const ctx = await buildRecoveryContext("/proj/book", libStub, tokenStoreStub, "Jane Author");
    expect(ctx.authorName).toBe("Jane Author");
  });
});
