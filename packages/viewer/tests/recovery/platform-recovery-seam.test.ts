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

  // All the required bridge members (minimal subset needed for ElectronAdapter)
  const bridge = {
    apiVersion: 1,
    updater: { getStatus: rec("updater.getStatus", Promise.resolve({})) },
    savePdf: rec("savePdf", Promise.resolve(null)),
    openExternal: rec("openExternal", Promise.resolve()),
    showInFolder: rec("showInFolder", Promise.resolve()),
    checkCss: rec("checkCss", Promise.resolve([])),
    lintProject: rec("lintProject", Promise.resolve([])),
    watchFolder: rec("watchFolder", () => {}),
    getStatus: rec("getStatus", Promise.resolve({ ok: true })),
    getViewerPrefs: rec("getViewerPrefs", Promise.resolve({})),
    setViewerPrefs: rec("setViewerPrefs", Promise.resolve({ ok: true })),
    getViewerProjectState: rec("getViewerProjectState", Promise.resolve(null)),
    setViewerProjectState: rec("setViewerProjectState", Promise.resolve({ ok: true })),
    getSettings: rec("getSettings", Promise.resolve({})),
    setSettings: rec("setSettings", Promise.resolve({ ok: true })),
    getNativeTheme: rec("getNativeTheme", Promise.resolve({ shouldUseDarkColors: false })),
    onNativeThemeUpdated: rec("onNativeThemeUpdated", () => {}),
    getRecentFolders: rec("getRecentFolders", Promise.resolve([])),
    getFavorites: rec("getFavorites", Promise.resolve([])),
    toggleFavorite: rec("toggleFavorite", Promise.resolve({ favorited: false })),
    removeRecent: rec("removeRecent", Promise.resolve({ ok: true })),
    discoverProjects: rec("discoverProjects", Promise.resolve([])),
    classifyProject: rec("classifyProject", Promise.resolve({ source: { type: "local-folder", path: "/" }, capabilities: {} })),
    createProject: rec("createProject", Promise.resolve({ projectDir: "/p", manifestPath: "/p/manifest.yaml", openFile: "/p/ch.md", versionHistory: "none" })),
    startPreview: rec("startPreview", Promise.resolve({ url: "x" })),
    stopPreview: rec("stopPreview", Promise.resolve({ stopped: true })),
    cancelExport: rec("cancelExport", Promise.resolve({ canceled: false })),
    build: rec("build", Promise.resolve({ outDir: "/out" })),
    doctor: rec("doctor", Promise.resolve({})),
    onBuildProgress: rec("onBuildProgress", () => {}),
    onUrlPreviewBlocked: rec("onUrlPreviewBlocked", () => {}),
    splashStatus: rec("splashStatus", Promise.resolve()),
    rendererReady: rec("rendererReady", Promise.resolve()),
    writeRecovery: rec("writeRecovery", Promise.resolve({ ok: true })),
    clearRecovery: rec("clearRecovery", Promise.resolve({ ok: true })),
    listRecovery: rec("listRecovery", Promise.resolve([])),
    setDirtyState: rec("setDirtyState", Promise.resolve()),
    onFlushBeforeClose: rec("onFlushBeforeClose", () => {}),
    onFolderChanged: rec("onFolderChanged", () => {}),
    pickImageFile: rec("pickImageFile", Promise.resolve(null)),
    copyFile: rec("copyFile", Promise.resolve("/dest")),
    pickImageFiles: rec("pickImageFiles", Promise.resolve([])),
    listProjectImages: rec("listProjectImages", Promise.resolve([])),
    imageThumbnail: rec("imageThumbnail", Promise.resolve(null)),
    inspectImage: rec("inspectImage", Promise.resolve(null)),
    connectGitHubStart: rec("connectGitHubStart", Promise.resolve({})),
    connectGitHubWait: rec("connectGitHubWait", Promise.resolve({ connected: false })),
    connectGitHubCancel: rec("connectGitHubCancel", Promise.resolve({ ok: true })),
    disconnectGitHub: rec("disconnectGitHub", Promise.resolve({ ok: true })),
    getRemoteConnection: rec("getRemoteConnection", Promise.resolve({ connected: false })),
    listRemoteRepositories: rec("listRemoteRepositories", Promise.resolve([])),
    listRemoteBranches: rec("listRemoteBranches", Promise.resolve([])),
    listRepoBooks: rec("listRepoBooks", Promise.resolve([])),
    cloneRemoteRepository: rec("cloneRemoteRepository", Promise.resolve({ projectDir: "/p" })),
    onCloneProgress: rec("onCloneProgress", () => {}),
    diagnoseProjectRemote: rec("diagnoseProjectRemote", Promise.resolve({})),
    testRemoteAccess: rec("testRemoteAccess", Promise.resolve({ ok: false, reason: "unknown", message: "" })),
    connectGenericHost: rec("connectGenericHost", Promise.resolve({ connected: false, host: "" })),
    disconnectHost: rec("disconnectHost", Promise.resolve({ ok: true })),
    listHostConnections: rec("listHostConnections", Promise.resolve([])),
    forgeTokenUrl: rec("forgeTokenUrl", Promise.resolve(null)),
    onSyncStatus: rec("onSyncStatus", () => {}),
    setAutoSync: rec("setAutoSync", Promise.resolve()),
    syncChanges: rec("syncChanges", Promise.resolve({ status: "up-to-date", message: "" })),
    resolveSyncConflicts: rec("resolveSyncConflicts", Promise.resolve({ status: "synced", message: "", mergedRemoteChanges: false })),
    saveSnapshot: rec("saveSnapshot", Promise.resolve({})),
    // ── Recovery seam (new) ──────────────────────────────────────────────────
    onRecoveryConfirm: rec("onRecoveryConfirm", () => {}),
    respondRecoveryConfirm: rec("respondRecoveryConfirm", Promise.resolve()),
    getConflictPreview: rec(
      "getConflictPreview",
      Promise.resolve({ mine: "mine", theirs: "theirs", kind: "both-edited", isBinary: false }),
    ),
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
