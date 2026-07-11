import { expect, test } from "bun:test";
import {
  ExportController,
  type ExportControllerDeps,
} from "../../electron/export/controller";
import type { ExportProgressEvent, ExportSession } from "../../electron/pdf-export";
import type { SyncStatusPayload } from "../../electron/auto-sync/orchestrator";

type LibModule = typeof import("@dimm-city/print-md");

class FakeBuildError extends Error {}

interface HarnessOpts {
  sourceType?: string;
  canSync?: boolean;
  isOnline?: boolean;
  /** Return value (or thrown value) of the fake syncProject during the export gate. */
  syncProject?: () => unknown;
  /** Return value (or thrown value) of the fake runBuild. */
  runBuild?: () => unknown;
  /** Pre-set active export session (simulates an in-progress export). */
  activeSession?: ExportSession | null;
  /** conflictLatched flag returned by sync.getState. */
  conflictLatched?: boolean;
}

interface Harness {
  controller: ExportController;
  progress: ExportProgressEvent[];
  emitted: SyncStatusPayload[];
  renamed: Array<[string, string]>;
  removed: string[];
  syncCalls: number;
  runBuildCalls: number;
  latched: Set<string>;
  getSession: () => ExportSession | null;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const progress: ExportProgressEvent[] = [];
  const emitted: SyncStatusPayload[] = [];
  const renamed: Array<[string, string]> = [];
  const removed: string[] = [];
  const latched = new Set<string>();
  const counters = { sync: 0, build: 0 };
  let session: ExportSession | null = opts.activeSession ?? null;

  const lib = {
    detectProjectSource: async () => ({ type: opts.sourceType ?? "local-folder" }),
    diagnoseProjectRemote: async () => ({ canSync: opts.canSync ?? false }),
    syncProject: async () => {
      counters.sync += 1;
      return opts.syncProject ? opts.syncProject() : { status: "up-to-date" };
    },
    splitOutPath: (tempOutPath: string) => ({ outDir: `${tempOutPath}.dir` }),
    runBuild: async () => {
      counters.build += 1;
      const r = opts.runBuild ? opts.runBuild() : { outDir: "/out", htmlPath: "/out/x.html", fingerprintPath: "/out/fp.json" };
      return r;
    },
    BuildError: FakeBuildError,
  } as unknown as LibModule;

  // Fakes the two-method ExportSyncGate surface (isConflictLatched +
  // latchConflict) that AutoSyncOrchestrator exposes — see finding #7. The
  // real latchConflict also cancels timers, stamps lastSyncAt, and emits the
  // conflict status; this fake mirrors just the emit so gate tests can still
  // assert on it.
  const sync: ExportControllerDeps["sync"] = {
    isConflictLatched: (dir) => latched.has(dir) || !!opts.conflictLatched,
    latchConflict: (dir, files) => {
      latched.add(dir);
      emitted.push({ state: "conflict", projectDir: dir, files, lastSyncAt: null });
    },
  };

  const deps: ExportControllerDeps = {
    loadLib: async () => lib,
    tokenStore: {} as ExportControllerDeps["tokenStore"],
    isOnline: () => opts.isOnline ?? true,
    usePuppeteer: () => false,
    pdfRenderer: (async () => {}) as ExportControllerDeps["pdfRenderer"],
    sync,
    getActiveExportSession: () => session,
    setActiveExportSession: (s) => {
      session = s;
    },
    sendProgress: (e) => progress.push(e),
    throwIfCanceled: (s) => {
      if (s.canceled) throw new Error("canceled");
    },
    isExportCanceledError: (e) =>
      e instanceof Error && (e as Error & { code?: string }).code === "EXPORT_CANCELED",
    rename: async (from, to) => {
      renamed.push([from, to]);
    },
    rm: async (p) => {
      removed.push(p);
    },
  };

  return {
    controller: new ExportController(deps),
    progress,
    emitted,
    renamed,
    removed,
    get syncCalls() {
      return counters.sync;
    },
    get runBuildCalls() {
      return counters.build;
    },
    latched,
    getSession: () => session,
  };
}

test("happy path builds, renames temp→out, emits started+success, clears session", async () => {
  const h = makeHarness();
  const res = await h.controller.build({ input: "/book", format: "pdf", out: "/out/book.pdf" });

  expect(res.pdfPath).toBe("/out/book.pdf");
  expect(res.outDir).toBe("/out");
  expect(h.renamed.length).toBe(1);
  expect(h.renamed[0]![1]).toBe("/out/book.pdf");
  expect(h.progress[0]?.state).toBe("started");
  expect(h.progress.some((p) => p.state === "success")).toBe(true);
  // session is cleared in finally
  expect(h.getSession()).toBeNull();
  // temp file is cleaned up
  expect(h.removed.length).toBe(1);
});

test("missing input is rejected before any work", async () => {
  const h = makeHarness();
  await expect(
    h.controller.build({ input: "", out: "/out/book.pdf" } as never),
  ).rejects.toThrow(/Missing 'input'/);
  expect(h.runBuildCalls).toBe(0);
});

test("missing out is rejected", async () => {
  const h = makeHarness();
  await expect(h.controller.build({ input: "/book" })).rejects.toThrow(/Missing 'out'/);
});

test("pdfx without icc is rejected", async () => {
  const h = makeHarness();
  await expect(
    h.controller.build({ input: "/book", format: "pdfx", out: "/out/book.pdf" }),
  ).rejects.toThrow(/PDF\/X/);
});

test("a second concurrent export is rejected while one is active", async () => {
  const active: ExportSession = {
    id: "x",
    canceled: false,
    outPath: "/o",
    tempOutPath: "/o.tmp",
    win: null,
  };
  const h = makeHarness({ activeSession: active });
  await expect(
    h.controller.build({ input: "/book", out: "/out/book.pdf" }),
  ).rejects.toThrow(/already in progress/);
  expect(h.runBuildCalls).toBe(0);
});

test("a conflict-latched project hard-blocks the export with SYNC_CONFLICT", async () => {
  const h = makeHarness({ conflictLatched: true });
  const err = await h.controller
    .build({ input: "/book", out: "/out/book.pdf" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("SYNC_CONFLICT");
  expect(h.runBuildCalls).toBe(0);
});

test("a conflict surfacing mid pre-export gate latches, emits, and blocks", async () => {
  const h = makeHarness({
    sourceType: "local-git-folder",
    canSync: true,
    isOnline: true,
    syncProject: () => ({ status: "conflict", files: [{ path: "a.md" }] }),
  });
  const err = await h.controller
    .build({ input: "/book", out: "/out/book.pdf" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("SYNC_CONFLICT");
  expect(h.emitted.some((e) => e.state === "conflict")).toBe(true);
  expect(h.runBuildCalls).toBe(0);
});

test("a BuildError from runBuild surfaces as a BUILD_ERROR", async () => {
  const h = makeHarness({
    runBuild: () => {
      throw new FakeBuildError("missing tool X");
    },
  });
  const err = await h.controller
    .build({ input: "/book", out: "/out/book.pdf" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("BUILD_ERROR");
  expect((err as Error).message).toBe("missing tool X");
  // session cleaned up even on failure
  expect(h.getSession()).toBeNull();
});
