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
  hostConfirmationGate,
  handleConfirmResponse,
  rejectAllPendingConfirms,
  buildRecoveryContext,
  preExportSyncGateBlockError,
} from "../../electron/recovery-bridge";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { classifyFromHealth } from "../../../cli/src/lib/remote-auth/recovery/classify.ts";

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

// The bridge sends renderer pushes through getAppHooks().sendToRenderer (the
// safeSend seam owned by main.ts) — register fake hooks that capture the calls.
function makeSentMessages() {
  const msgs: Array<{ channel: string; args: unknown[] }> = [];
  registerHostServices({
    app: {
      setRendererDirty: () => {},
      sendToRenderer: (ch: string, ...a: unknown[]) => {
        msgs.push({ channel: ch, args: a });
      },
    },
  } as unknown as HostServices);
  return { msgs };
}

afterEach(() => {
  rejectAllPendingConfirms();
  registerHostServices(undefined as unknown as HostServices);
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

  test("a specific interrupted-op repair beats the generic stale-lock cleanup", () => {
    // The abort repair for the interrupted operation is the more specific fix;
    // any leftover lock is re-detected (and cleared) on the following pass.
    expect(
      classifyFromHealth({
        ...makeGoodHealth(),
        hasStaleLock: true,
        lockAgeMs: 150_000,
        hasInterruptedMerge: true,
        isDetachedHead: true,
      }),
    ).toBe("interrupted_merge");
  });

  test("stale_lock (old enough, ≥ 2 min) classifies when it is the only condition", () => {
    expect(
      classifyFromHealth({
        ...makeGoodHealth(),
        hasStaleLock: true,
        lockAgeMs: 150_000,
      }),
    ).toBe("stale_lock");
  });

  test("interrupted_rebase beats merge and detached", () => {
    expect(
      classifyFromHealth({
        ...makeGoodHealth(),
        hasInterruptedMerge: true,
        hasInterruptedRebase: true,
        isDetachedHead: true,
      }),
    ).toBe("interrupted_rebase");
  });

  test("interrupted rebase maps to interrupted_rebase (first-class, beats detached_head)", () => {
    // An interrupted rebase is not a non-fast-forward push rejection and it
    // usually detaches HEAD; the dedicated abort repair must win over both.
    expect(
      classifyFromHealth({ ...makeGoodHealth(), hasInterruptedRebase: true, isDetachedHead: true }),
    ).toBe("interrupted_rebase");
  });

  test("cherry-pick maps to interrupted_cherry_pick (first-class, not merge_conflict)", () => {
    expect(
      classifyFromHealth({ ...makeGoodHealth(), hasInterruptedCherryPick: true }),
    ).toBe("interrupted_cherry_pick");
  });

  test("detached_head (lowest priority) → detached_head when nothing else active", () => {
    expect(
      classifyFromHealth({ ...makeGoodHealth(), isDetachedHead: true }),
    ).toBe("detached_head");
  });

  test("healthy repo is never classified as 'unknown'", () => {
    // classifyFromHealth returns a concrete structural kind or null; a healthy
    // snapshot must yield null, so it can never be mistaken for a repair path.
    const result = classifyFromHealth(makeGoodHealth());
    expect(result).toBeNull();
    expect(result).not.toBe("unknown");
  });
});

describe("buildRecoveryContext delegation", () => {
  // Resolution behavior (repo root, branch fallback, credential, slug) is the
  // LIB's responsibility now — tested in cli recovery/context.test.ts. The
  // bridge's job is only: delegate to lib.buildRecoveryContext and attach the
  // Electron dialog gate.
  test("delegates to lib.buildRecoveryContext with the host dialog gate attached", async () => {
    let received: Record<string, unknown> | null = null;
    const lib = {
      buildRecoveryContext: async (options: Record<string, unknown>) => {
        received = options;
        return { projectDir: options.projectDir, repoDir: "/project" };
      },
    };
    const tokenStore = {
      get: async () => null,
      delete: async () => undefined,
    };

    const ctx = await buildRecoveryContext(
      "/project",
      lib as never,
      tokenStore,
      "Ada",
      "/tmp/op.log",
    );

    expect(ctx.repoDir).toBe("/project");
    expect(received!.projectDir).toBe("/project");
    expect(received!.tokenStore).toBe(tokenStore);
    expect(received!.authorName).toBe("Ada");
    expect(received!.logFile).toBe("/tmp/op.log");
    // The host contributes its own ConfirmationGate.
    expect(typeof (received!.confirmation as { confirmRepair?: unknown }).confirmRepair).toBe(
      "function",
    );
  });
});

describe("pre-export sync gate error policy", () => {
  test("RepoNeedsRecovery blocks export instead of being swallowed as a soft sync failure", () => {
    const err = Object.assign(new Error("repair required"), {
      code: "RepoNeedsRecovery",
      kind: "interrupted_merge",
    });

    const block = preExportSyncGateBlockError(err);

    expect(block).toBeInstanceOf(Error);
    expect((block as Error & { code?: string }).code).toBe("SYNC_CONFLICT");
    expect(block?.message).toContain("needs repair");
  });

  test("ordinary sync gate errors remain non-blocking for export", () => {
    const err = Object.assign(new Error("offline"), { code: "NetworkUnavailable" });

    expect(preExportSyncGateBlockError(err)).toBeNull();
  });
});

// ── 2. hostConfirmationGate + handleConfirmResponse roundtrip ─────────────────

describe("hostConfirmationGate + handleConfirmResponse roundtrip (real code)", () => {
  const DIR = "/proj/test-book";

  test("classified kind — emits 'recovery:confirm-request', resolves true on handleConfirmResponse", async () => {
    const { msgs } = makeSentMessages();

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
    const { msgs } = makeSentMessages();

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
    makeSentMessages();

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
    makeSentMessages();

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
    makeSentMessages();

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

// ── 5. buildRecoveryContext ───────────────────────────────────────────────────
// The context RESOLUTION (repo root, branch, credential, slug) moved to the
// lib — packages/cli/src/lib/remote-auth/recovery/context.test.ts covers it.
// The bridge's remaining responsibility (delegate + attach the dialog gate) is
// covered by the "buildRecoveryContext delegation" describe above.
