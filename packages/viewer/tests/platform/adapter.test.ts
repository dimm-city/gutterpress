import { test, expect, beforeEach, afterEach } from "bun:test";
import { ElectronAdapter } from "../../src/lib/platform/electron-adapter";
import { WebAdapter } from "../../src/lib/platform/web-adapter";
import { getPlatform, isDesktop, __resetPlatform } from "../../src/lib/platform/index";

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
    openDirectory: rec("openDirectory", Promise.resolve("/proj")),
    savePdf: rec("savePdf", Promise.resolve("/out.pdf")),
    openExternal: rec("openExternal", Promise.resolve()),
    showInFolder: rec("showInFolder", Promise.resolve()),
    readFile: rec("readFile", Promise.resolve("file-body")),
    writeFile: rec("writeFile", Promise.resolve()),
    listDir: rec(
      "listDir",
      Promise.resolve([{ name: "a.md", path: "/proj/a.md", isDir: false }]),
    ),
    listProjectFiles: rec(
      "listProjectFiles",
      Promise.resolve({ md: ["01-intro.md"], css: ["theme.css"] }),
    ),
    checkCss: rec("checkCss", Promise.resolve([])),
    lintProject: rec(
      "lintProject",
      Promise.resolve([
        {
          filePath: "/proj/01-intro.md",
          file: "01-intro.md",
          line: 4,
          severity: "error",
          message: "Local reference not found: ./missing.png",
          source: "source.links.local-refs",
        },
      ]),
    ),
    getStatus: rec("getStatus", Promise.resolve({ ok: true })),
    getLastProject: rec("getLastProject", Promise.resolve(null)),
    getViewerPrefs: rec("getViewerPrefs", Promise.resolve({})),
    setViewerPrefs: rec("setViewerPrefs", Promise.resolve({ ok: true })),
    getViewerProjectState: rec("getViewerProjectState", Promise.resolve({ currentPage: 5 })),
    setViewerProjectState: rec("setViewerProjectState", Promise.resolve({ ok: true })),
    getSettings: rec("getSettings", Promise.resolve({ appearance: { previewBg: "#abc" } })),
    setSettings: rec("setSettings", Promise.resolve({ ok: true })),
    getNativeTheme: rec("getNativeTheme", Promise.resolve({ shouldUseDarkColors: true })),
    onNativeThemeUpdated: rec("onNativeThemeUpdated", () => {}),
    getRecentFolders: rec(
      "getRecentFolders",
      Promise.resolve([{ path: "/proj", title: "My Book", openedAt: "2026-01-01", exists: true }]),
    ),
    getFavorites: rec(
      "getFavorites",
      Promise.resolve([{ path: "/proj", title: "My Book", exists: true }]),
    ),
    toggleFavorite: rec("toggleFavorite", Promise.resolve({ favorited: true })),
    removeRecent: rec("removeRecent", Promise.resolve({ ok: true })),
    discoverProjects: rec("discoverProjects", Promise.resolve([])),
    classifyProject: rec(
      "classifyProject",
      Promise.resolve({
        source: { type: "local-folder", path: "/proj" },
        capabilities: { canSnapshot: false },
      }),
    ),
    createProject: rec(
      "createProject",
      Promise.resolve({
        projectDir: "/proj/my-book",
        manifestPath: "/proj/my-book/manifest.yaml",
        openFile: "/proj/my-book/chapter-01.md",
        versionHistory: "local-git",
      }),
    ),
    startPreview: rec("startPreview", Promise.resolve({ url: "x" })),
    stopPreview: rec("stopPreview", Promise.resolve({ stopped: true })),
    cancelExport: rec("cancelExport", Promise.resolve({ canceled: true })),
    build: rec("build", Promise.resolve({ outDir: "/out" })),
    doctor: rec("doctor", Promise.resolve({})),
    onBuildProgress: rec("onBuildProgress", () => {}),
    onUrlPreviewBlocked: rec("onUrlPreviewBlocked", () => {}),
    // #44 unsaved-changes / recovery surface
    statFile: rec(
      "statFile",
      Promise.resolve({ mtimeMs: 123, size: 7, exists: true }),
    ),
    watchFolder: rec("watchFolder", () => {}),
    writeRecovery: rec("writeRecovery", Promise.resolve({ ok: true })),
    clearRecovery: rec("clearRecovery", Promise.resolve({ ok: true })),
    listRecovery: rec("listRecovery", Promise.resolve([])),
    setDirtyState: rec("setDirtyState", Promise.resolve()),
    onFlushBeforeClose: rec("onFlushBeforeClose", () => {}),
    onFolderChanged: rec("onFolderChanged", () => {}),
    // #47 Media panel surface
    pickImageFiles: rec("pickImageFiles", Promise.resolve(["/pick/a.png"])),
    listProjectImages: rec(
      "listProjectImages",
      Promise.resolve([
        { name: "a.png", relPath: "assets/a.png", path: "/proj/assets/a.png", size: 10, mtimeMs: 1 },
      ]),
    ),
    imageThumbnail: rec("imageThumbnail", Promise.resolve("data:image/png;base64,AAA")),
    inspectImage: rec(
      "inspectImage",
      Promise.resolve({
        fileSize: 10,
        info: { width: 100, height: 50, xDpi: 72, yDpi: 72, hasAlpha: false, colorSpace: "srgb" },
      }),
    ),
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

test("getPlatform() falls back to WebAdapter without a bridge", () => {
  // @ts-expect-error test global
  globalThis.window = {};
  expect(isDesktop()).toBe(false);
  expect(getPlatform()).toBeInstanceOf(WebAdapter);
});

test("ElectronAdapter maps openFolder → openDirectory and delegates 1:1", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  // #49: openFolder wraps the bridge's path string into a host-neutral FolderRef.
  await expect(p.openFolder()).resolves.toEqual({ key: "/proj", displayName: "proj" });
  await expect(p.readFile("/a.md")).resolves.toBe("file-body");
  await p.writeFile("/a.md", "hello");
  await expect(p.listDir("/proj")).resolves.toEqual([
    { name: "a.md", path: "/proj/a.md", isDir: false },
  ]);
  await expect(p.listProjectFiles("/proj")).resolves.toEqual({
    md: ["01-intro.md"],
    css: ["theme.css"],
  });
  await p.build({ input: { key: "/proj", displayName: "proj" }, format: "pdf" });
  await p.startPreview({ input: { key: "/proj", displayName: "proj" } });
  await p.doctor();

  // #49: recents/favorites rows map path → key + derived displayName, other fields forwarded.
  await expect(p.getRecentFolders()).resolves.toEqual([
    { key: "/proj", displayName: "proj", title: "My Book", openedAt: "2026-01-01", exists: true },
  ]);
  await expect(p.getFavorites()).resolves.toEqual([
    { key: "/proj", displayName: "proj", title: "My Book", exists: true },
  ]);
  await expect(p.classifyProject("/proj")).resolves.toEqual({
    source: { type: "local-folder", path: "/proj" },
    capabilities: { canSnapshot: false },
  });
  await expect(
    p.createProject({ name: "My Book", parentDir: "/proj" }),
  ).resolves.toEqual({
    projectDir: "/proj/my-book",
    manifestPath: "/proj/my-book/manifest.yaml",
    openFile: "/proj/my-book/chapter-01.md",
    versionHistory: "local-git",
  });
  expect(p.apiVersion).toBe(1);

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("openDirectory");
  expect(methods).toContain("readFile");
  expect(methods).toContain("writeFile");
  expect(methods).toContain("listDir");
  expect(methods).toContain("listProjectFiles");
  expect(calls.find((c) => c.method === "listProjectFiles")?.args).toEqual(["/proj"]);
  expect(methods).toContain("build");
  // #49: the adapter unwraps FolderRef.key → the string `input` the IPC expects.
  expect(calls.find((c) => c.method === "build")?.args).toEqual([
    { input: "/proj", format: "pdf" },
  ]);
  // #49: startPreview likewise unwraps FolderRef.key → the string `input` the IPC expects.
  expect(calls.find((c) => c.method === "startPreview")?.args).toEqual([
    { input: "/proj" },
  ]);
  expect(methods).toContain("classifyProject");
  expect(calls.find((c) => c.method === "classifyProject")?.args).toEqual(["/proj"]);
  expect(methods).toContain("createProject");
  expect(calls.find((c) => c.method === "createProject")?.args).toEqual([
    { name: "My Book", parentDir: "/proj" },
  ]);
  expect(calls.find((c) => c.method === "writeFile")?.args).toEqual(["/a.md", "hello"]);
});

test("ElectronAdapter delegates lintProject (#28) 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  const entries = await p.lintProject("/proj");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toEqual({
    filePath: "/proj/01-intro.md",
    file: "01-intro.md",
    line: 4,
    severity: "error",
    message: "Local reference not found: ./missing.png",
    source: "source.links.local-refs",
  });
  expect(calls.find((c) => c.method === "lintProject")?.args).toEqual(["/proj"]);
});

test("WebAdapter.lintProject degrades to no findings (#28)", async () => {
  const p = new WebAdapter();
  await expect(p.lintProject("/proj")).resolves.toEqual([]);
});

test("ElectronAdapter delegates per-project state (#43) 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  await expect(p.getViewerProjectState("/proj")).resolves.toEqual({ currentPage: 5 });
  await expect(p.setViewerProjectState("/proj", { currentPage: 9 })).resolves.toEqual({
    ok: true,
  });

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("getViewerProjectState");
  expect(methods).toContain("setViewerProjectState");
  expect(calls.find((c) => c.method === "getViewerProjectState")?.args).toEqual(["/proj"]);
  expect(calls.find((c) => c.method === "setViewerProjectState")?.args).toEqual([
    "/proj",
    { currentPage: 9 },
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

  await expect(p.statFile("/p")).resolves.toEqual({ mtimeMs: 123, size: 7, exists: true });
  const unwatch = p.watchFolder("/p", () => {});
  expect(typeof unwatch).toBe("function");
  await expect(p.writeRecovery("/p", "x", 42)).resolves.toEqual({ ok: true });
  await expect(p.clearRecovery("/p")).resolves.toEqual({ ok: true });
  await expect(p.listRecovery("/p")).resolves.toEqual([]);
  await p.setDirtyState(true);
  const offFlush = p.onFlushBeforeClose(() => {});
  expect(typeof offFlush).toBe("function");
  const offFolder = p.onFolderChanged(() => {});
  expect(typeof offFolder).toBe("function");

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("statFile");
  expect(methods).toContain("watchFolder");
  expect(methods).toContain("writeRecovery");
  expect(methods).toContain("clearRecovery");
  expect(methods).toContain("listRecovery");
  expect(methods).toContain("setDirtyState");
  expect(methods).toContain("onFlushBeforeClose");
  expect(methods).toContain("onFolderChanged");
  expect(calls.find((c) => c.method === "statFile")?.args).toEqual(["/p"]);
  expect(calls.find((c) => c.method === "writeRecovery")?.args).toEqual(["/p", "x", 42]);
  expect(calls.find((c) => c.method === "setDirtyState")?.args).toEqual([true]);
});

test("ElectronAdapter delegates getSettings/setSettings 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  await expect(p.getSettings()).resolves.toEqual({ appearance: { previewBg: "#abc" } });
  await expect(p.setSettings({ appearance: { previewBg: "#123" } })).resolves.toEqual({ ok: true });

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("getSettings");
  expect(methods).toContain("setSettings");
  expect(calls.find((c) => c.method === "setSettings")?.args).toEqual([
    { appearance: { previewBg: "#123" } },
  ]);
});

test("ElectronAdapter delegates getNativeTheme/onNativeThemeUpdated 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  await expect(p.getNativeTheme()).resolves.toEqual({ shouldUseDarkColors: true });
  const unsub = p.onNativeThemeUpdated(() => {});
  expect(typeof unsub).toBe("function");

  const methods = calls.map((c) => c.method);
  expect(methods).toContain("getNativeTheme");
  expect(methods).toContain("onNativeThemeUpdated");
});

test("WebAdapter.getNativeTheme reads matchMedia; onNativeThemeUpdated subscribes", async () => {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  // @ts-expect-error test global
  globalThis.matchMedia = (_q: string) => ({
    matches: true,
    addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) =>
      listeners.push(cb),
    removeEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  });
  try {
    const p = new WebAdapter();
    await expect(p.getNativeTheme()).resolves.toEqual({ shouldUseDarkColors: true });

    let received: boolean | null = null;
    const unsub = p.onNativeThemeUpdated((s) => (received = s.shouldUseDarkColors));
    expect(listeners.length).toBe(1);
    listeners[0]!({ matches: false });
    expect(received).toBe(false);
    unsub();
    expect(listeners.length).toBe(0);
  } finally {
    // @ts-expect-error test global
    globalThis.matchMedia = undefined;
  }
});

test("WebAdapter.getSettings returns defaults merged with localStorage, setSettings persists", async () => {
  const store = new Map<string, string>();
  // @ts-expect-error test global
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    const p = new WebAdapter();
    // Defaults are returned when nothing is stored.
    const defaults = await p.getSettings();
    expect(defaults.appearance.previewBg).toBe("#5a5a5a");
    expect(defaults.preview.viewMode).toBe("two-column");

    // A patch persists and merges over defaults on the next read.
    await expect(p.setSettings({ appearance: { previewBg: "#101010" } })).resolves.toEqual({
      ok: true,
    });
    const after = await p.getSettings();
    expect(after.appearance.previewBg).toBe("#101010");
    // Unrelated sections retain their defaults.
    expect(after.preview.viewMode).toBe("two-column");
  } finally {
    // @ts-expect-error test global
    globalThis.localStorage = undefined;
  }
});

test("WebAdapter: primitives throw, host methods reject, subscriptions are no-ops", async () => {
  const p = new WebAdapter();
  expect(p.platform).toBe("web");
  expect(() => p.openFolder()).toThrow(/0\.6\.0/);
  expect(() => p.watchFolder("/p", () => {})).toThrow(/0\.6\.0/);
  expect(() => p.listDir("/p")).toThrow(/0\.6\.0/);
  await expect(
    p.startPreview({ input: { key: "/p", displayName: "p" } }),
  ).rejects.toThrow(/0\.6\.0/);
  await expect(p.setViewerPrefs({})).rejects.toThrow(/0\.6\.0/);
  await expect(p.getViewerProjectState("/p")).rejects.toThrow(/0\.6\.0/);
  await expect(p.setViewerProjectState("/p", {})).rejects.toThrow(/0\.6\.0/);
  await expect(p.listProjectFiles("/p")).rejects.toThrow(/0\.6\.0/);
  // Project discovery resolves to [] on web (no scan), not a rejection.
  await expect(p.discoverProjects()).resolves.toEqual([]);
  await expect(p.classifyProject("/p")).rejects.toThrow(/0\.6\.0/);
  await expect(p.createProject({ name: "X", parentDir: "/p" })).rejects.toThrow(/0\.6\.0/);
  // Subscriptions must return a callable unsubscribe (the app stores it).
  expect(typeof p.onBuildProgress(() => {})).toBe("function");
  expect(typeof p.onUrlPreviewBlocked(() => {})).toBe("function");
  // #44 unsaved-changes surface is desktop-only: primitives throw, recovery
  // writes reject, listRecovery resolves to [], subscriptions are no-ops.
  expect(() => p.statFile("/p")).toThrow(/0\.6\.0/);
  await expect(p.writeRecovery("/p", "x", 0)).rejects.toThrow(/0\.6\.0/);
  await expect(p.clearRecovery("/p")).rejects.toThrow(/0\.6\.0/);
  await expect(p.listRecovery("/p")).resolves.toEqual([]);
  await expect(p.setDirtyState(true)).rejects.toThrow(/0\.6\.0/);
  expect(typeof p.onFlushBeforeClose(() => {})).toBe("function");
  expect(typeof p.onFolderChanged(() => {})).toBe("function");
  // #47 Media panel: listing/import reject (panel guards with isDesktop());
  // thumbnails + inspection degrade to null so detail chrome renders safely.
  await expect(p.pickImageFiles()).rejects.toThrow(/0\.6\.0/);
  await expect(p.listProjectImages("/p")).rejects.toThrow(/0\.6\.0/);
  await expect(p.imageThumbnail("/p/a.png")).resolves.toBeNull();
  await expect(p.inspectImage("/p/a.png")).resolves.toBeNull();
});

test("ElectronAdapter delegates the #47 Media panel surface 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();
  await p.pickImageFiles();
  const images = await p.listProjectImages("/proj");
  expect(images[0]?.relPath).toBe("assets/a.png");
  await p.imageThumbnail("/proj/assets/a.png");
  const details = await p.inspectImage("/proj/assets/a.png");
  expect(details?.info?.width).toBe(100);
  expect(calls.find((c) => c.method === "pickImageFiles")?.args).toEqual([]);
  expect(calls.find((c) => c.method === "listProjectImages")?.args).toEqual(["/proj"]);
  expect(calls.find((c) => c.method === "imageThumbnail")?.args).toEqual(["/proj/assets/a.png"]);
  expect(calls.find((c) => c.method === "inspectImage")?.args).toEqual(["/proj/assets/a.png"]);
});
