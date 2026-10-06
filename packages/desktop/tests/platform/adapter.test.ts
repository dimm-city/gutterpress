import { test, expect, beforeEach, afterEach } from "bun:test";
import { ElectronAdapter } from "../../src/lib/platform/electron-adapter";
import { getPlatform, __resetPlatform } from "../../src/lib/platform/index";

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
    updater: { applyNow: rec("updater.applyNow", Promise.resolve()), onEvent: rec("updater.onEvent", () => {}) },
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
    // GitHub integration (#15) — connect stays on the bridge; everything else is a server route
    connectGitHubStart: rec("connectGitHubStart", Promise.resolve({})),
    connectGitHubWait: rec("connectGitHubWait", Promise.resolve({})),
    connectGitHubCancel: rec("connectGitHubCancel", Promise.resolve({ ok: true })),
    onCloneProgress: rec("onCloneProgress", () => {}),
    // Sync surface
    onSyncStatus: rec("onSyncStatus", () => {}),
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

test("getPlatform() returns the memoised ElectronAdapter", () => {
  const { bridge } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = getPlatform();
  expect(p).toBeInstanceOf(ElectronAdapter);
  expect(getPlatform()).toBe(p); // memoised
});

test("ElectronAdapter unwraps FolderRef for build/startPreview and delegates 1:1", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  await p.build({ input: { key: "/proj", displayName: "proj" }, format: "pdf" });
  await p.startPreview({ input: { key: "/proj", displayName: "proj" } });

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
