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
    onNativeThemeUpdated: rec("onNativeThemeUpdated", () => {}),
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
    // Version history surface (#13) — saveSnapshot stays on bridge; others migrated to server routes
    saveSnapshot: rec("saveSnapshot", Promise.resolve({ id: "sha1", message: "snap", timestamp: 1 })),
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

test("WebAdapter.onNativeThemeUpdated subscribes to matchMedia changes", async () => {
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

test("WebAdapter: primitives throw, host methods reject, subscriptions are no-ops", async () => {
  const p = new WebAdapter(new InMemoryWebStore());
  expect(p.platform).toBe("web");
  // #33 Phase 1: the FSA fs primitives are implemented. With no folder opened
  // (and no FSA picker on this environment) they fail gracefully rather than
  // with the old 0.6.0 stub message:
  //  - openFolder rejects "not supported" when showDirectoryPicker is absent.
  //  - listDir rejects because no root handle is registered.
  //  - statFile resolves { exists:false } (never throws) so callers can probe.
  await expect(p.openFolder()).rejects.toThrow(/File System Access|not supported/i);
  await expect(p.listDir("web:none/p")).rejects.toThrow(/handle/i);
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
  // Subscriptions must return a callable unsubscribe (the app stores it).
  expect(typeof p.onBuildProgress(() => {})).toBe("function");
  expect(typeof p.onUrlPreviewBlocked(() => {})).toBe("function");
  // #44 unsaved-changes surface subscriptions are no-ops on web.
  expect(typeof p.onFlushBeforeClose(() => {})).toBe("function");
  expect(typeof p.onFolderChanged(() => {})).toBe("function");
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

test("WebAdapter read/write/list/stat work against an opened folder (#33)", async () => {
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

