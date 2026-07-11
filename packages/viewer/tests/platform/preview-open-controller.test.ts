import { expect, test } from "bun:test";
import {
  PreviewOpenController,
  type PreviewHandle,
  type PreviewOpenControllerDeps,
} from "../../electron/preview/controller";
import type { SyncStatusPayload } from "../../electron/auto-sync/orchestrator";
import type { ViewerPrefs } from "../../electron/prefs-store";

type LibModule = typeof import("@dimm-city/print-md");

interface HarnessOpts {
  sourceType?: "local-folder" | "local-git-folder";
  subPath?: string;
  repoRoot?: string;
  canSync?: boolean;
  manifestTitle?: string | undefined;
  manifestThrows?: boolean;
  startPreviewServer?: () => unknown;
  activePreview?: PreviewHandle | null;
  watchedDir?: string | null;
}

interface Harness {
  controller: PreviewOpenController;
  calls: string[];
  prefsWrites: Array<(prefs: ViewerPrefs) => ViewerPrefs>;
  emitted: SyncStatusPayload[];
  timers: Array<{ cb: () => void; ms: number; unrefed: boolean }>;
  mkdirCalls: string[];
  appendFileCalls: string[];
  getActivePreview: () => PreviewHandle | null;
  runPreflightCalls: Array<[string, unknown]>;
  startCalls: number;
}

function makeHandle(over: Partial<PreviewHandle> = {}): PreviewHandle {
  return {
    url: "http://127.0.0.1:1234",
    port: 1234,
    inputPath: "/book",
    missingSharedAssets: [],
    stop: async () => {},
    ...over,
  };
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const calls: string[] = [];
  const prefsWrites: Array<(prefs: ViewerPrefs) => ViewerPrefs> = [];
  const emitted: SyncStatusPayload[] = [];
  const timers: Array<{ cb: () => void; ms: number; unrefed: boolean }> = [];
  const mkdirCalls: string[] = [];
  const appendFileCalls: string[] = [];
  const runPreflightCalls: Array<[string, unknown]> = [];
  let startCalls = 0;
  let activePreview: PreviewHandle | null = opts.activePreview ?? null;
  let watchedDir: string | null = opts.watchedDir ?? null;

  const lib = {
    startPreviewServer: async (serverOpts: { input: string }) => {
      startCalls += 1;
      calls.push("startPreviewServer");
      return opts.startPreviewServer
        ? opts.startPreviewServer()
        : makeHandle({ inputPath: serverOpts.input });
    },
    loadManifestWithPath: async () => {
      if (opts.manifestThrows) throw new Error("no manifest");
      return { manifest: { title: opts.manifestTitle }, manifestDir: "/book" };
    },
    detectProjectSource: async () =>
      opts.sourceType === "local-git-folder"
        ? {
            type: "local-git-folder" as const,
            path: "/book",
            repoRoot: opts.repoRoot ?? "/book",
            subPath: opts.subPath ?? "",
            hasRemote: true,
          }
        : { type: "local-folder" as const, path: "/book" },
    diagnoseProjectRemote: async () => {
      calls.push("diagnoseProjectRemote");
      return { canSync: opts.canSync ?? false };
    },
  } as unknown as LibModule;

  const deps: PreviewOpenControllerDeps = {
    loadLib: async () => lib,
    getActivePreview: () => activePreview,
    setActivePreview: (p) => {
      activePreview = p;
    },
    updatePrefs: async (mutate) => {
      calls.push("updatePrefs");
      prefsWrites.push(mutate);
      return mutate({});
    },
    tokenStore: {} as PreviewOpenControllerDeps["tokenStore"],
    operationLogPath: (slug) => `/logs/${slug}.log`,
    emitSyncStatus: (payload) => {
      calls.push("emitSyncStatus");
      emitted.push(payload);
    },
    getWatchedDir: () => watchedDir,
    armSyncInterval: async (dir) => {
      calls.push(`armSyncInterval:${dir}`);
    },
    runSyncPreflight: async (dir, source) => {
      calls.push(`runSyncPreflight:${dir}`);
      runPreflightCalls.push([dir, source]);
    },
    refreshAppHeartbeat: async (dir) => {
      calls.push(`refreshAppHeartbeat:${dir}`);
    },
    mkdir: async (dir) => {
      mkdirCalls.push(dir);
    },
    appendFile: async (filePath) => {
      appendFileCalls.push(filePath);
    },
    setTimeout: (cb, ms) => {
      const entry = { cb, ms, unrefed: false };
      timers.push(entry);
      return {
        unref: () => {
          entry.unrefed = true;
        },
      };
    },
  };

  return {
    controller: new PreviewOpenController(deps),
    calls,
    prefsWrites,
    emitted,
    timers,
    mkdirCalls,
    appendFileCalls,
    getActivePreview: () => activePreview,
    runPreflightCalls,
    get startCalls() {
      return startCalls;
    },
  };
}

/** Flush the local-status fire-and-forget microtask chain before assertions. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("missing input is rejected before any work", async () => {
  const h = makeHarness();
  await expect(h.controller.open({})).rejects.toThrow(/Missing 'input'/);
  expect(h.startCalls).toBe(0);
});

test("happy path (local-folder): starts server, sets activePreview, returns result shape", async () => {
  const h = makeHarness({ sourceType: "local-folder" });
  const res = await h.controller.open({ input: "/book" });

  expect(res).toEqual({
    url: "http://127.0.0.1:1234",
    port: 1234,
    input: "/book",
    title: "book",
    missingSharedAssets: [],
  });
  expect(h.getActivePreview()?.inputPath).toBe("/book");
});

test("title falls back to dir basename when no manifest, and adopts manifest.title when present", async () => {
  const h1 = makeHarness({ manifestThrows: true });
  const r1 = await h1.controller.open({ input: "/some/book" });
  expect(r1.title).toBe("book");

  const h2 = makeHarness({ manifestTitle: "My Great Book" });
  const r2 = await h2.controller.open({ input: "/some/book" });
  expect(r2.title).toBe("My Great Book");
});

test("an existing active preview is stopped before starting the new one", async () => {
  let stopped = false;
  const existing = makeHandle({
    stop: async () => {
      stopped = true;
    },
  });
  const h = makeHarness({ activePreview: existing });
  await h.controller.open({ input: "/book" });
  expect(stopped).toBe(true);
  expect(h.getActivePreview()?.inputPath).toBe("/book");
});

test("startPreviewServer failure wraps the message and leaves activePreview untouched", async () => {
  const h = makeHarness({
    startPreviewServer: () => {
      throw new Error("port in use");
    },
  });
  const err = await h.controller.open({ input: "/book" }).catch((e) => e);
  expect((err as Error).message).toBe("Preview server failed to start: port in use");
  expect(h.getActivePreview()).toBeNull();
});

test("recents upsert: local-folder keys on the opened dir, no lastActiveBook", async () => {
  const h = makeHarness({ sourceType: "local-folder" });
  await h.controller.open({ input: "/book" });
  expect(h.prefsWrites.length).toBe(1);
  const result = h.prefsWrites[0]!({});
  expect(result.recentFolders?.[0]).toMatchObject({ path: "/book", title: "book" });
  expect(result.recentFolders?.[0]).not.toHaveProperty("lastActiveBook");
  expect(result.lastProjectDir).toBe("/book");
});

test("recents upsert: local-git-folder with a subPath keys on repoRoot and stamps lastActiveBook", async () => {
  const h = makeHarness({
    sourceType: "local-git-folder",
    repoRoot: "/repo",
    subPath: "books/field-guide",
  });
  await h.controller.open({ input: "/repo/books/field-guide" });
  const result = h.prefsWrites[0]!({});
  expect(result.recentFolders?.[0]).toMatchObject({
    path: "/repo",
    lastActiveBook: "/repo/books/field-guide",
  });
});

test("recents upsert: local-git-folder AT the repo root (no subPath) omits lastActiveBook", async () => {
  const h = makeHarness({
    sourceType: "local-git-folder",
    repoRoot: "/repo",
    subPath: "",
  });
  await h.controller.open({ input: "/repo" });
  const result = h.prefsWrites[0]!({});
  expect(result.recentFolders?.[0]).not.toHaveProperty("lastActiveBook");
});

test("armSyncInterval and runSyncPreflight always fire for the opened dir", async () => {
  const h = makeHarness({ sourceType: "local-folder" });
  await h.controller.open({ input: "/book" });
  expect(h.calls).toContain("armSyncInterval:/book");
  expect(h.runPreflightCalls).toEqual([["/book", { type: "local-folder", path: "/book" }]]);
});

test("refreshAppHeartbeat fires only for local-git-folder sources", async () => {
  const gitH = makeHarness({ sourceType: "local-git-folder", repoRoot: "/book" });
  await gitH.controller.open({ input: "/book" });
  expect(gitH.calls).toContain("refreshAppHeartbeat:/book");

  const plainH = makeHarness({ sourceType: "local-folder" });
  await plainH.controller.open({ input: "/book" });
  expect(plainH.calls).not.toContain("refreshAppHeartbeat:/book");
});

test("local-status: skipped entirely for local-folder sources (no diagnose, no emit)", async () => {
  const h = makeHarness({ sourceType: "local-folder" });
  await h.controller.open({ input: "/book" });
  await settle();
  expect(h.calls).not.toContain("diagnoseProjectRemote");
  expect(h.emitted).toEqual([]);
});

test("local-status: skipped when the project can sync (sync flow owns the pill)", async () => {
  const h = makeHarness({ sourceType: "local-git-folder", repoRoot: "/book", canSync: true });
  await h.controller.open({ input: "/book" });
  await settle();
  expect(h.calls).toContain("diagnoseProjectRemote");
  expect(h.emitted).toEqual([]);
});

test("local-status: emitted immediately for a remote-less local-git-folder, log file ensured, re-emit armed", async () => {
  const h = makeHarness({ sourceType: "local-git-folder", repoRoot: "/book", canSync: false, watchedDir: "/book" });
  await h.controller.open({ input: "/book" });
  await settle();

  expect(h.mkdirCalls).toEqual(["/logs"]);
  expect(h.appendFileCalls).toEqual(["/logs/book.log"]);
  expect(h.emitted.length).toBe(1);
  expect(h.emitted[0]).toEqual({
    state: "local",
    projectDir: "/book",
    lastSyncAt: null,
    logFile: "/logs/book.log",
  });

  // The delayed re-emit is armed with the exact same payload and unref'd.
  expect(h.timers.length).toBe(1);
  expect(h.timers[0]!.unrefed).toBe(true);
  h.timers[0]!.cb();
  expect(h.emitted.length).toBe(2);
  expect(h.emitted[1]).toEqual(h.emitted[0]);
});

test("local-status: delayed re-emit is cancelled (skipped) if the project switched before it fires", async () => {
  const h = makeHarness({ sourceType: "local-git-folder", repoRoot: "/book", canSync: false, watchedDir: "/other" });
  await h.controller.open({ input: "/book" });
  await settle();
  expect(h.emitted.length).toBe(1);
  h.timers[0]!.cb();
  // getWatchedDir() !== openedDir ("/other" !== "/book") — no second emit.
  expect(h.emitted.length).toBe(1);
});

test("overlapping open() calls are serialized in arrival order", async () => {
  const order: string[] = [];
  let resolveFirstStart!: () => void;
  const firstStartGate = new Promise<void>((resolve) => {
    resolveFirstStart = resolve;
  });
  let starts = 0;

  const lib = {
    startPreviewServer: async (opts: { input: string }) => {
      starts += 1;
      if (starts === 1) {
        order.push("start-first");
        // Hold the first call's server start open until the test releases it,
        // so a second open() arriving in the meantime can only run once this
        // one's runOpen() has fully settled — proving the chain serializes
        // rather than the two just happening to interleave in-order anyway.
        await firstStartGate;
      } else {
        order.push("start-second");
      }
      return makeHandle({ inputPath: opts.input });
    },
    loadManifestWithPath: async () => ({ manifest: {}, manifestDir: "/" }),
    detectProjectSource: async () => ({ type: "local-folder" as const, path: "/" }),
    diagnoseProjectRemote: async () => ({ canSync: false }),
  } as unknown as LibModule;

  let activePreview: PreviewHandle | null = null;
  const controller = new PreviewOpenController({
    loadLib: async () => lib,
    getActivePreview: () => activePreview,
    setActivePreview: (p) => {
      activePreview = p;
    },
    updatePrefs: async (mutate) => mutate({}),
    tokenStore: {} as PreviewOpenControllerDeps["tokenStore"],
    operationLogPath: (slug) => `/logs/${slug}.log`,
    emitSyncStatus: () => {},
    getWatchedDir: () => null,
    armSyncInterval: async () => {},
    runSyncPreflight: async () => {},
    refreshAppHeartbeat: async () => {},
    mkdir: async () => {},
    appendFile: async () => {},
    setTimeout: (cb) => {
      cb();
      return {};
    },
  });

  const p1 = controller.open({ input: "/book1" }).then((r) => {
    order.push("done-first");
    return r;
  });
  // Second call arrives while the first is still in flight.
  const p2 = controller.open({ input: "/book2" }).then((r) => {
    order.push("done-second");
    return r;
  });

  // Give both open() calls a chance to be invoked and queued before releasing
  // the first — if they weren't serialized, "start-second" would appear here.
  await settle();
  expect(order).toEqual(["start-first"]);

  resolveFirstStart();
  const [r1, r2] = await Promise.all([p1, p2]);

  expect(order).toEqual(["start-first", "done-first", "start-second", "done-second"]);
  expect(r1.input).toBe("/book1");
  expect(r2.input).toBe("/book2");
});
