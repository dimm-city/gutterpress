import { test, expect, beforeEach, afterEach } from "bun:test";
import { ElectronAdapter } from "../../src/lib/platform/electron-adapter";
import {
  getPlatform,
  isDesktop,
  __resetPlatform,
  DesktopHostRequiredError,
} from "../../src/lib/platform/index";

// ── Test harness: a fake window.electron that records calls ──────────────────
function makeBridge() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec =
    (method: string, ret: unknown = undefined) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return ret;
    };
  const bridge = {
    apiVersion: 1,
    updater: { getStatus: rec("updater.getStatus", Promise.resolve({})) },
    onNativeThemeUpdated: rec("onNativeThemeUpdated", () => {}),
    onOpenMarkdownFile: rec("onOpenMarkdownFile", () => {}),
    startPreview: rec("startPreview", Promise.resolve({ url: "x" })),
    stopPreview: rec("stopPreview", Promise.resolve({ stopped: true })),
    cancelExport: rec("cancelExport", Promise.resolve({ canceled: true })),
    build: rec("build", Promise.resolve({ outDir: "/out" })),
    onBuildProgress: rec("onBuildProgress", () => {}),
    onUrlPreviewBlocked: rec("onUrlPreviewBlocked", () => {}),
    // #44 unsaved-changes / recovery surface
    watchFolder: rec("watchFolder", () => {}),
    onFlushBeforeClose: rec("onFlushBeforeClose", () => {}),
    onFolderChanged: rec("onFolderChanged", () => {}),
    // GitHub integration (#15) — connect/clone stay on bridge; read methods migrated to server routes
    connectGitHubStart: rec("connectGitHubStart", Promise.resolve({})),
    connectGitHubWait: rec("connectGitHubWait", Promise.resolve({})),
    connectGitHubCancel: rec("connectGitHubCancel", Promise.resolve({ ok: true })),
    cloneRemoteRepository: rec("cloneRemoteRepository", Promise.resolve({ projectDir: "/proj" })),
    onCloneProgress: rec("onCloneProgress", () => {}),
    // Sync surface
    onSyncStatus: rec("onSyncStatus", () => {}),
    setAutoSync: rec("setAutoSync", Promise.resolve()),
    onRecoveryConfirm: rec("onRecoveryConfirm", () => {}),
    respondRecoveryConfirm: rec("respondRecoveryConfirm", Promise.resolve()),
    resolveSyncConflicts: rec("resolveSyncConflicts", Promise.resolve({ status: "synced" })),
  };
  return { bridge, calls };
}

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

test("getPlatform() selects ElectronAdapter when the bridge is present", () => {
  const { bridge } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  expect(isDesktop()).toBe(true);
  const p = getPlatform();
  expect(p.platform).toBe("electron");
  expect(p).toBeInstanceOf(ElectronAdapter);
  expect(getPlatform()).toBe(p); // memoised
});

test("getPlatform() fails loudly with a named error when no Electron bridge is present (SFE-P5a)", () => {
  // @ts-expect-error test global
  globalThis.window = {};
  expect(isDesktop()).toBe(false);
  expect(() => getPlatform()).toThrow(DesktopHostRequiredError);
  expect(() => getPlatform()).toThrow(/desktop host required/i);
});

test("ElectronAdapter maps openFolder → openDirectory and delegates 1:1", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  // openFolder now calls api.dialog.openDirectory() (a fetch POST), not bridge().openDirectory()
  const origFetch = globalThis.fetch;
  // @ts-expect-error test global
  globalThis.fetch = async (_url: string) => ({ ok: true, json: async () => "/proj" });
  try {
    // #49: openFolder wraps the path string into a host-neutral FolderRef.
    await expect(p.openFolder()).resolves.toEqual({ key: "/proj", displayName: "proj" });
  } finally {
    globalThis.fetch = origFetch;
  }

  await p.build({ input: { key: "/proj", displayName: "proj" }, format: "pdf" });
  await p.startPreview({ input: { key: "/proj", displayName: "proj" } });
  expect(p.apiVersion).toBe(1);

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("build");
  // #49: the adapter unwraps FolderRef.key → the string `input` the IPC expects.
  expect(calls.find((c) => c.method === "build")?.args).toEqual([
    { input: "/proj", format: "pdf" },
  ]);
  // #49: startPreview likewise unwraps FolderRef.key → the string `input` the IPC expects.
  expect(calls.find((c) => c.method === "startPreview")?.args).toEqual([
    { input: "/proj" },
  ]);
});


test("ElectronAdapter throws for scaffold-only methods (no IPC behind them)", () => {
  const { bridge } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();
  // #12 secrets — still scaffolded; must throw a clear not-implemented error.
  expect(() => p.getSecret("k")).toThrow(/not implemented/i);
  expect(() => p.setSecret("k", "v")).toThrow(/not implemented/i);
});

test("ElectronAdapter delegates the #44 unsaved-changes surface 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  const unwatch = p.watchFolder("/p", () => {});
  expect(typeof unwatch).toBe("function");
  const offFlush = p.onFlushBeforeClose(() => {});
  expect(typeof offFlush).toBe("function");
  const offFolder = p.onFolderChanged(() => {});
  expect(typeof offFolder).toBe("function");

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("watchFolder");
  expect(methods).toContain("onFlushBeforeClose");
  expect(methods).toContain("onFolderChanged");
});

test("ElectronAdapter delegates onNativeThemeUpdated 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  const unsub = p.onNativeThemeUpdated(() => {});
  expect(typeof unsub).toBe("function");

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("onNativeThemeUpdated");
});

test("ElectronAdapter delegates Markdown file-launch events 1:1 to the bridge", () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  const unsub = p.onOpenMarkdownFile(() => {});
  expect(typeof unsub).toBe("function");
  expect(calls.map((c) => c.method)).toContain("onOpenMarkdownFile");
});
