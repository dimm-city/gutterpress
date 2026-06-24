import { test, expect, beforeEach, afterEach } from "bun:test";
import { ElectronAdapter } from "../../src/lib/platform/electron-adapter";
import { WebAdapter } from "../../src/lib/platform/web-adapter";
import { InMemoryWebStore } from "../../src/lib/platform/web-store";
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
    // #31 Insert Image — single file picker (returns a raw path string at the bridge)
    pickImageFile: rec("pickImageFile", Promise.resolve("/pick/cover.png")),
    copyFile: rec("copyFile", Promise.resolve("/proj/assets/cover.png")),
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
  const p = new WebAdapter(new InMemoryWebStore());
  expect(p.platform).toBe("web");
  // #33 Phase 1: the FSA fs primitives are implemented. With no folder opened
  // (and no FSA picker on this environment) they fail gracefully rather than
  // with the old 0.6.0 stub message:
  //  - openFolder rejects "not supported" when showDirectoryPicker is absent.
  //  - listDir/listProjectFiles reject because no root handle is registered.
  //  - statFile resolves { exists:false } (never throws) so callers can probe.
  await expect(p.openFolder()).rejects.toThrow(/File System Access|not supported/i);
  await expect(p.listDir("web:none/p")).rejects.toThrow(/handle/i);
  await expect(p.listProjectFiles("web:none")).rejects.toThrow(/handle/i);
  await expect(p.statFile("web:none/p")).resolves.toEqual({
    size: 0,
    mtimeMs: 0,
    exists: false,
  });
  // watchFolder: no FS-watch API on web, but the contract returns an unsubscribe
  // fn — it must be a safe no-op, NOT a throw (callers do `const off = watch(...)`).
  const off = p.watchFolder("/p", () => {});
  expect(typeof off).toBe("function");
  expect(() => off()).not.toThrow();
  // #33 Phase 2: startPreview is implemented; with no folder opened the root
  // key is unregistered, so it rejects with the handle-registry error (NOT the
  // old 0.6.0 stub). The happy-path render is covered by the Phase 2 tests below.
  await expect(
    p.startPreview({ input: { key: "web:none", displayName: "p" } }),
  ).rejects.toThrow(/handle/i);
  // #33 Phase 3: prefs + per-project state are now IndexedDB-backed (here the
  // injected in-memory store), so they round-trip instead of rejecting.
  await expect(p.setViewerPrefs({})).resolves.toEqual({ ok: true });
  await expect(p.getViewerProjectState("/p")).resolves.toBeNull();
  await expect(p.setViewerProjectState("/p", {})).resolves.toEqual({ ok: true });
  // Project discovery resolves to [] on web (no scan), not a rejection.
  await expect(p.discoverProjects()).resolves.toEqual([]);
  await expect(p.classifyProject("/p")).rejects.toThrow(/0\.6\.0/);
  await expect(p.createProject({ name: "X", parentDir: "/p" })).rejects.toThrow(/0\.6\.0/);
  // Subscriptions must return a callable unsubscribe (the app stores it).
  expect(typeof p.onBuildProgress(() => {})).toBe("function");
  expect(typeof p.onUrlPreviewBlocked(() => {})).toBe("function");
  // #44 unsaved-changes surface is desktop-only: recovery writes reject,
  // listRecovery resolves to [], subscriptions are no-ops.
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

test("ElectronAdapter.pickImageFile wraps the bridge path → host-neutral FileRef (#61)", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();

  // #61: the bridge returns the chosen absolute path (a string); the adapter
  // wraps it into a FileRef { key = path, displayName = basename } so the
  // renderer never assumes path-string semantics (PWA/FSA-ready).
  await expect(p.pickImageFile()).resolves.toEqual({
    key: "/pick/cover.png",
    displayName: "cover.png",
  });
  expect(calls.find((c) => c.method === "pickImageFile")?.args).toEqual([]);

  // copyFile still takes/returns raw path strings (no FileRef at this seam).
  await expect(p.copyFile("/pick/cover.png", "/proj/assets")).resolves.toBe(
    "/proj/assets/cover.png",
  );
  expect(calls.find((c) => c.method === "copyFile")?.args).toEqual([
    "/pick/cover.png",
    "/proj/assets",
  ]);
});

test("ElectronAdapter.pickImageFile returns null when the dialog is cancelled (#61)", async () => {
  const { bridge } = makeBridge();
  // dialog cancelled → bridge resolves null; adapter must return null, NOT fileRef(null).
  (bridge as Record<string, unknown>).pickImageFile = () => Promise.resolve(null);
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  const p = new ElectronAdapter();
  await expect(p.pickImageFile()).resolves.toBeNull();
});

test("WebAdapter.pickImageFile rejects until the PWA adapter lands (#61)", async () => {
  const p = new WebAdapter();
  await expect(p.pickImageFile()).rejects.toThrow(/0\.6\.0/);
});

// ── #33 Phase 1: FSA fs primitives behind the WebAdapter ─────────────────────

// A tiny in-memory FSA mock (same shape as web-fs.test.ts) so the adapter can be
// exercised end-to-end (openFolder → read/write/list) without a real browser.
function makeFsaTree() {
  class MockFile {
    readonly kind = "file" as const;
    constructor(
      public name: string,
      public contents = "",
      public lastModified = 1000,
    ) {}
    async getFile() {
      return {
        name: this.name,
        lastModified: this.lastModified,
        size: new TextEncoder().encode(this.contents).length,
        text: () => Promise.resolve(this.contents),
      };
    }
    async createWritable() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      return {
        async write(d: string) {
          self.contents = d;
        },
        async close() {
          self.lastModified = 2000;
        },
      };
    }
  }
  class MockDir {
    readonly kind = "directory" as const;
    children = new Map<string, MockFile | MockDir>();
    constructor(public name: string) {}
    addFile(n: string, c = "") {
      const f = new MockFile(n, c);
      this.children.set(n, f);
      return f;
    }
    async getDirectoryHandle(n: string, o?: { create?: boolean }) {
      let c = this.children.get(n);
      if (!c && o?.create) c = (() => {
        const d = new MockDir(n);
        this.children.set(n, d);
        return d;
      })();
      if (!c || c.kind !== "directory") throw new DOMException("NotFound", "NotFoundError");
      return c;
    }
    async getFileHandle(n: string, o?: { create?: boolean }) {
      let c = this.children.get(n);
      if (!c && o?.create) c = this.addFile(n);
      if (!c || c.kind !== "file") throw new DOMException("NotFound", "NotFoundError");
      return c;
    }
    async *entries() {
      for (const e of this.children) yield e;
    }
  }
  const root = new MockDir("my-book");
  root.addFile("01-intro.md", "# Intro\n");
  root.addFile("theme.css", "body{}");
  return root;
}

test("WebAdapter.capabilities reports FSA-present set when showDirectoryPicker exists (#33)", () => {
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => {} };
  try {
    const p = new WebAdapter();
    expect(p.capabilities()).toEqual({
      nativeSavePath: false,
      showInFolder: false,
      persistentFolderAccess: true,
    });
  } finally {
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.capabilities reports all-false without FSA (Safari/no-FSA) (#33)", () => {
  // @ts-expect-error test global
  globalThis.window = {};
  try {
    const p = new WebAdapter();
    expect(p.capabilities()).toEqual({
      nativeSavePath: false,
      showInFolder: false,
      persistentFolderAccess: false,
    });
  } finally {
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.openFolder registers the handle and returns {key, displayName} (#33)", async () => {
  const root = makeFsaTree();
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(root) };
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = await p.openFolder();
    expect(ref).not.toBeNull();
    expect(ref!.displayName).toBe("my-book");
    expect(typeof ref!.key).toBe("string");

    // The returned key resolves back to the open root for reads.
    await expect(p.readFile(`${ref!.key}/01-intro.md`)).resolves.toBe("# Intro\n");
  } finally {
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.openFolder returns null when the picker is cancelled (AbortError) (#33)", async () => {
  // @ts-expect-error test global
  globalThis.window = {
    showDirectoryPicker: () =>
      Promise.reject(new DOMException("The user aborted a request.", "AbortError")),
  };
  try {
    const p = new WebAdapter();
    await expect(p.openFolder()).resolves.toBeNull();
  } finally {
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter read/write/list/stat/listProjectFiles work against an opened folder (#33)", async () => {
  const root = makeFsaTree();
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(root) };
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;
    const SEP = "/";

    // listDir at the project root.
    const entries = await p.listDir(ref.key);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["01-intro.md", "theme.css"]);

    // statFile.
    const stat = await p.statFile(`${ref.key}${SEP}01-intro.md`);
    expect(stat.exists).toBe(true);
    expect(stat.size).toBe(new TextEncoder().encode("# Intro\n").length);

    // writeFile → returns a re-stat mtime, and readFile sees the new content.
    const w = await p.writeFile(`${ref.key}${SEP}01-intro.md`, "# New\n");
    expect(w.mtimeMs).toBe(2000);
    await expect(p.readFile(`${ref.key}${SEP}01-intro.md`)).resolves.toBe("# New\n");

    // listProjectFiles filters md/css.
    await expect(p.listProjectFiles(ref.key)).resolves.toEqual({
      md: ["01-intro.md"],
      css: ["theme.css"],
    });
  } finally {
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

// ── #33 Phase 2: in-browser preview render (no server, no Chromium) ──────────

/**
 * Stub `URL.createObjectURL`/`revokeObjectURL` (absent in bun's test env) so the
 * WebAdapter can mint/revoke blob URLs, and capture the Blob text so the test can
 * assert on the assembled book.html. Returns the captured state + a restore fn.
 */
function stubObjectUrls() {
  const created: string[] = [];
  const revoked: string[] = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  const origCreate = (URL as { createObjectURL?: unknown }).createObjectURL;
  const origRevoke = (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  // @ts-expect-error test stub
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:mock/${n++}`;
    created.push(url);
    blobs.set(url, blob);
    return url;
  };
  // @ts-expect-error test stub
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  return {
    created,
    revoked,
    blobs,
    restore() {
      // @ts-expect-error test stub
      URL.createObjectURL = origCreate;
      // @ts-expect-error test stub
      URL.revokeObjectURL = origRevoke;
    },
  };
}

test("WebAdapter.startPreview renders book.html in-browser → blob URL (#33 Phase 2)", async () => {
  const root = makeFsaTree();
  root.addFile("02-body.md", "## Body\n\nSentinel content here.\n");
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(root) };
  const urls = stubObjectUrls();
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;

    const result = await p.startPreview({ input: ref });

    // Returns a blob: object URL matching the PreviewStartResult shape.
    expect(result.url).toMatch(/^blob:/);
    expect(result.port).toBe(0);
    expect(result.input).toBe(ref.key);
    expect(result.title).toBe("my-book");
    expect(urls.created).toHaveLength(1);

    // The assembled HTML contains the rendered markdown + the paged runtime +
    // the inlined project CSS.
    const html = await urls.blobs.get(result.url)!.text();
    expect(html).toContain(">Intro</h1>"); // from 01-intro.md (# Intro)
    expect(html).toContain("Sentinel content here."); // from 02-body.md
    expect(html).toContain("paged.polyfill.js");
    expect(html).toContain("data-project-css"); // theme.css inlined
    expect(html).toContain("body{}"); // theme.css contents inlined

    // #33 Phase 4: the paged.js runtime must be referenced from a SAME-ORIGIN,
    // service-worker-cacheable path (so preview works OFFLINE), NOT from the
    // unpkg CDN the pure render core defaults to. A blob: document inherits the
    // creating page's origin, so an absolute-path URL resolves same-origin.
    expect(html).toContain('src="/vendor/paged.polyfill.js"');
    expect(html).not.toContain("unpkg.com");
  } finally {
    urls.restore();
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.stopPreview revokes the last object URL (#33 Phase 2)", async () => {
  const root = makeFsaTree();
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(root) };
  const urls = stubObjectUrls();
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;
    const result = await p.startPreview({ input: ref });

    await expect(p.stopPreview()).resolves.toEqual({ stopped: true });
    expect(urls.revoked).toContain(result.url);
  } finally {
    urls.restore();
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.startPreview revokes the prior URL before minting a new one (#33)", async () => {
  const root = makeFsaTree();
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(root) };
  const urls = stubObjectUrls();
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;
    const first = await p.startPreview({ input: ref });
    const second = await p.startPreview({ input: ref });
    expect(first.url).not.toBe(second.url);
    // The first URL is revoked when the second is minted (no blob leak).
    expect(urls.revoked).toContain(first.url);
    expect(urls.revoked).not.toContain(second.url);
  } finally {
    urls.restore();
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.startPreview throws when the project has no markdown (#33)", async () => {
  const emptyRoot = (() => {
    const r = makeFsaTree();
    r.children.delete("01-intro.md");
    return r;
  })();
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(emptyRoot) };
  const urls = stubObjectUrls();
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;
    await expect(p.startPreview({ input: ref })).rejects.toThrow(/no markdown/i);
  } finally {
    urls.restore();
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

// ── #33 Phase 5: HTML export on web + PDF gating ─────────────────────────────

test("WebAdapter.build({format:'html'}) returns a blob downloadUrl with the rendered book (#33 Phase 5)", async () => {
  const root = makeFsaTree();
  root.addFile("02-body.md", "## Body\n\nSentinel content here.\n");
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(root) };
  const urls = stubObjectUrls();
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;

    const result = await p.build({ input: ref, format: "html" });

    // The web delivery is a blob: object URL the SPA turns into a download.
    expect(result.downloadUrl).toBeDefined();
    expect(result.downloadUrl).toMatch(/^blob:/);
    expect(urls.created).toHaveLength(1);
    // The adapter must NOT revoke the download URL — ownership transfers to the
    // SPA, which revokes it only after triggering the <a download> click.
    expect(urls.revoked).toHaveLength(0);
    // The contract requires outDir; a sensible html filename is exposed too.
    expect(typeof result.outDir).toBe("string");
    expect(result.htmlPath).toMatch(/\.html$/);

    // The blob contains the SAME rendered book.html as startPreview: rendered
    // markdown + inlined project CSS + the same-origin paged.js polyfill.
    const html = await urls.blobs.get(result.downloadUrl!)!.text();
    expect(html).toContain(">Intro</h1>"); // from 01-intro.md (# Intro)
    expect(html).toContain("Sentinel content here."); // from 02-body.md
    expect(html).toContain("data-project-css"); // theme.css inlined
    expect(html).toContain("body{}"); // theme.css contents inlined
    expect(html).toContain('src="/vendor/paged.polyfill.js"');
    expect(html).not.toContain("unpkg.com");
  } finally {
    urls.restore();
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
});

test("WebAdapter.build({format:'pdf'}) rejects with a desktop-only message (#33 Phase 5)", async () => {
  const p = new WebAdapter(new InMemoryWebStore());
  await expect(
    p.build({ input: { key: "web:none", displayName: "p" }, format: "pdf" }),
  ).rejects.toThrow(/PDF export requires the desktop app/i);
});

test("WebAdapter.build({format:'pdfx'}) rejects with a desktop-only message (#33 Phase 5)", async () => {
  const p = new WebAdapter(new InMemoryWebStore());
  await expect(
    p.build({ input: { key: "web:none", displayName: "p" }, format: "pdfx" }),
  ).rejects.toThrow(/PDF export requires the desktop app/i);
});

test("WebAdapter.build({format:'html'}) throws when the project has no markdown (#33 Phase 5)", async () => {
  const emptyRoot = (() => {
    const r = makeFsaTree();
    r.children.delete("01-intro.md");
    return r;
  })();
  // @ts-expect-error test global
  globalThis.window = { showDirectoryPicker: () => Promise.resolve(emptyRoot) };
  const urls = stubObjectUrls();
  try {
    const p = new WebAdapter(new InMemoryWebStore());
    const ref = (await p.openFolder())!;
    await expect(p.build({ input: ref, format: "html" })).rejects.toThrow(/no markdown/i);
  } finally {
    urls.restore();
    // @ts-expect-error test global
    globalThis.window = undefined;
  }
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
