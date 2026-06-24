/**
 * Tests for the hostConfirmationGate ↔ renderer bridge.
 *
 * Exercises the REAL exports from electron/recovery-bridge.ts:
 *   - hostConfirmationGate
 *   - handleConfirmResponse
 *   - rejectAllPendingConfirms
 *   - setRecoveryBridgeWindow
 *
 * Verifies:
 * 1. confirmRepair sends 'recovery:confirm-request' to the renderer with a requestId
 * 2. handleConfirmResponse resolves confirmRepair with the approved value
 * 3. A stale/unknown requestId returns false from handleConfirmResponse
 * 4. A pending confirm resolves false when rejectAllPendingConfirms is called
 * 5. Only one pending confirm per project at a time (supersede)
 * 6. A non-responding renderer resolves false after timeout (default-safe)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  hostConfirmationGate,
  handleConfirmResponse,
  rejectAllPendingConfirms,
  setRecoveryBridgeWindow,
} from "../../electron/recovery-bridge";
import type { RepairConfirmation } from "@dimm-city/print-md-lib";

// ── Mock BrowserWindow ────────────────────────────────────────────────────────
// We stub the BrowserWindow so the bridge can send IPC events without Electron.
// Capture the calls so tests can verify the message payload.

interface SentMessage {
  channel: string;
  args: unknown[];
}

function makeWindowMock(): { win: ReturnType<typeof buildMockWin>; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  const win = buildMockWin(sent);
  return { win, sent };
}

function buildMockWin(sent: SentMessage[]) {
  return {
    webContents: {
      send(channel: string, ...args: unknown[]) {
        sent.push({ channel, args });
      },
    },
    // Minimal BrowserWindow shape — ElectronAdapter tests handle the rest
    isDestroyed: () => false,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRepairConfirmation(): RepairConfirmation {
  return {
    repair: "stale_lock",
    risk: "low",
    summary: "Remove a leftover lock file so sync can continue.",
    backupZipPath: "/tmp/backup.zip",
    willChangeLocalFiles: false,
    willChangeGitMetadata: true,
    willChangeRemote: false,
    canBeUndoneFromBackup: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("hostConfirmationGate bridge (real implementation)", () => {
  const DIR = "/proj/my-book";

  afterEach(() => {
    // Clear any pending confirms between tests so state doesn't bleed.
    rejectAllPendingConfirms();
    setRecoveryBridgeWindow(null);
  });

  test("confirmRepair sends 'recovery:confirm-request' to the renderer with a requestId", async () => {
    const { win, sent } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const req = makeRepairConfirmation();

    // Don't await — let it hang until we respond
    const promise = gate.confirmRepair(req);

    expect(sent).toHaveLength(1);
    const msg = sent[0]!;
    expect(msg.channel).toBe("recovery:confirm-request");
    const payload = msg.args[0] as { requestId: string; projectDir: string; confirmation: RepairConfirmation };
    expect(payload.projectDir).toBe(DIR);
    expect(payload.confirmation).toBe(req);
    expect(typeof payload.requestId).toBe("string");
    expect(payload.requestId.length).toBeGreaterThan(4);

    // Respond so the promise settles
    handleConfirmResponse(payload.requestId, true);
    expect(await promise).toBe(true);
  });

  test("handleConfirmResponse(approved=true) resolves confirmRepair with true", async () => {
    const { win, sent } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const promise = gate.confirmRepair(makeRepairConfirmation());
    const requestId = (sent[0]!.args[0] as { requestId: string }).requestId;

    handleConfirmResponse(requestId, true);
    expect(await promise).toBe(true);
  });

  test("handleConfirmResponse(approved=false) resolves confirmRepair with false", async () => {
    const { win, sent } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const promise = gate.confirmRepair(makeRepairConfirmation());
    const requestId = (sent[0]!.args[0] as { requestId: string }).requestId;

    handleConfirmResponse(requestId, false);
    expect(await promise).toBe(false);
  });

  test("stale/unknown requestId returns false from handleConfirmResponse (does not resolve pending)", async () => {
    const { win, sent } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const promise = gate.confirmRepair(makeRepairConfirmation());
    const requestId = (sent[0]!.args[0] as { requestId: string }).requestId;

    const found = handleConfirmResponse("completely-unknown-id", true);
    expect(found).toBe(false);

    // The real promise is still pending — clean up
    handleConfirmResponse(requestId, false);
    await promise;
  });

  test("rejectAllPendingConfirms resolves all pending with false", async () => {
    const { win } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    const gate1 = hostConfirmationGate(DIR);
    const gate2 = hostConfirmationGate("/proj/other-book");

    const p1 = gate1.confirmRepair(makeRepairConfirmation());
    const p2 = gate2.confirmRepair(makeRepairConfirmation());

    rejectAllPendingConfirms();

    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
  });

  test("only one pending confirm per project — new request supersedes the old", async () => {
    const { win } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    const gate = hostConfirmationGate(DIR);
    const p1 = gate.confirmRepair(makeRepairConfirmation());

    // Immediately fire a second confirmRepair for the same project
    const gate2 = hostConfirmationGate(DIR);
    const p2 = gate2.confirmRepair(makeRepairConfirmation());

    // p1 should have been resolved false (superseded)
    expect(await p1).toBe(false);

    // p2 is still pending — respond to it
    handleConfirmResponse(
      // The pending confirm's requestId is in the most recently sent message
      // sent[1] if the window was set — look via rejectAll to clean up safely
      "force-resolve", // unknown — won't match
      false,
    );
    // Clean up p2 via rejectAll
    rejectAllPendingConfirms();
    expect(await p2).toBe(false);
  });

  test("confirmRepair resolves false after timeout (default-safe, does not wedge inFlight)", async () => {
    const { win } = makeWindowMock();
    // @ts-expect-error minimal mock shape
    setRecoveryBridgeWindow(win);

    // Use a very short timeout for the test
    const gate = hostConfirmationGate(DIR, 50 /* ms */);
    const promise = gate.confirmRepair(makeRepairConfirmation());

    // Do NOT respond — let the timeout fire
    const result = await promise;
    expect(result).toBe(false);
  });
});
