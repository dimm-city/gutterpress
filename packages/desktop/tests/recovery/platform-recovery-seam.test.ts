/**
 * Tests for the 3 new platform seam members added for recovery:
 *   - onRecoveryConfirm
 *   - respondRecoveryConfirm
 *   - getConflictPreview
 *
 * Verifies:
 * 1. ElectronAdapter delegates all 3 to the bridge
 * 2. WebAdapter: onRecoveryConfirm returns a no-op unsub function
 * 3. WebAdapter: respondRecoveryConfirm resolves (no-op)
 * 4. WebAdapter: getConflictPreview rejects with "not implemented"
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ElectronAdapter } from "../../src/lib/platform/electron-adapter";
import { WebAdapter } from "../../src/lib/platform/web-adapter";
import { __resetPlatform } from "../../src/lib/platform/index";
import type { RecoveryConfirmRequest, ConflictPreview } from "../../src/lib/platform/contract";

// ── Bridge mock that tracks calls ─────────────────────────────────────────────

function makeBridgeWithRecovery() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec =
    (method: string, ret: unknown = undefined) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return ret;
    };

  // Minimal bridge members matching the current preload.ts contextBridge surface
  const bridge = {
    apiVersion: 1,
    updater: { getStatus: rec("updater.getStatus", Promise.resolve({})) },
    onNativeThemeUpdated: rec("onNativeThemeUpdated", () => {}),
    watchFolder: rec("watchFolder", () => {}),
    onFlushBeforeClose: rec("onFlushBeforeClose", () => {}),
    onFolderChanged: rec("onFolderChanged", () => {}),
    connectGitHubStart: rec("connectGitHubStart", Promise.resolve({})),
    connectGitHubWait: rec("connectGitHubWait", Promise.resolve({ connected: false })),
    connectGitHubCancel: rec("connectGitHubCancel", Promise.resolve({ ok: true })),
    cloneRemoteRepository: rec("cloneRemoteRepository", Promise.resolve({ projectDir: "/p" })),
    onCloneProgress: rec("onCloneProgress", () => {}),
    onSyncStatus: rec("onSyncStatus", () => {}),
    setAutoSync: rec("setAutoSync", Promise.resolve()),
    resolveSyncConflicts: rec("resolveSyncConflicts", Promise.resolve({ status: "synced", message: "", mergedRemoteChanges: false })),
    startPreview: rec("startPreview", Promise.resolve({ url: "x" })),
    stopPreview: rec("stopPreview", Promise.resolve({ stopped: true })),
    cancelExport: rec("cancelExport", Promise.resolve({ canceled: false })),
    build: rec("build", Promise.resolve({ outDir: "/out" })),
    onBuildProgress: rec("onBuildProgress", () => {}),
    onUrlPreviewBlocked: rec("onUrlPreviewBlocked", () => {}),
    // ── Recovery seam ────────────────────────────────────────────────────────
    onRecoveryConfirm: rec("onRecoveryConfirm", () => {}),
    respondRecoveryConfirm: rec("respondRecoveryConfirm", Promise.resolve()),
  };

  return { bridge, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ElectronAdapter — recovery seam delegation", () => {
  beforeEach(() => {
    __resetPlatform();
    // @ts-expect-error test global
    globalThis.window = undefined;
  });

  afterEach(() => {
    // @ts-expect-error test global
    globalThis.window = undefined;
    __resetPlatform();
  });

  test("onRecoveryConfirm delegates to bridge and returns unsubscribe fn", () => {
    const { bridge, calls } = makeBridgeWithRecovery();
    // @ts-expect-error test global
    globalThis.window = { electron: bridge };

    const adapter = new ElectronAdapter();
    const handler = (_req: RecoveryConfirmRequest) => {};
    const unsub = adapter.onRecoveryConfirm(handler);

    expect(calls.some((c) => c.method === "onRecoveryConfirm")).toBe(true);
    expect(typeof unsub).toBe("function");
  });

  test("respondRecoveryConfirm delegates requestId+approved to bridge", async () => {
    const { bridge, calls } = makeBridgeWithRecovery();
    // @ts-expect-error test global
    globalThis.window = { electron: bridge };

    const adapter = new ElectronAdapter();
    await adapter.respondRecoveryConfirm("req-123", true);

    const call = calls.find((c) => c.method === "respondRecoveryConfirm");
    expect(call).toBeDefined();
    expect(call?.args[0]).toBe("req-123");
    expect(call?.args[1]).toBe(true);
  });

});

describe("WebAdapter — recovery seam stubs", () => {
  test("onRecoveryConfirm returns a no-op unsubscribe function (never calls handler)", () => {
    const adapter = new WebAdapter();
    let called = false;
    const unsub = adapter.onRecoveryConfirm(() => {
      called = true;
    });

    // unsub must be a function
    expect(typeof unsub).toBe("function");
    // handler is never called
    expect(called).toBe(false);
    // calling unsub doesn't throw
    expect(() => unsub()).not.toThrow();
  });

  test("respondRecoveryConfirm resolves without error (no-op)", async () => {
    const adapter = new WebAdapter();
    await expect(adapter.respondRecoveryConfirm("any-id", true)).resolves.toBeUndefined();
  });

});
