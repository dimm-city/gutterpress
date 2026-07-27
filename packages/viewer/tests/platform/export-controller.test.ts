import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  /**
   * Fake for the `consumeSavePath` capability check (finding #4). Defaults to
   * an always-authorize `() => true` so every pre-existing test — none of
   * which exercises the save-path capability — keeps its prior "the `out` I
   * passed is always accepted" behavior unchanged.
   */
  consumeSavePath?: (absPath: string) => boolean;
  /**
   * Flips the (by-then-minted) active session's `canceled` flag while
   * syncProject is in flight — simulates a Cancel click landing during the
   * pre-export sync gate (M28).
   */
  cancelDuringSync?: boolean;
  /** The author's configured commit identity the pre-export sync gate must pass on. */
  gitIdentity?: { authorName?: string; authorEmail?: string };
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
  /** Args of every fake syncProject() call, in order. */
  syncArgs: unknown[];
  /** Args of every fake runBuild() call, in order — lets tests assert on the
   * resolved `outDir`/`pdfFileOverride` (the workspace/destination split). */
  buildArgs: Array<{ outDir?: string; pdfFileOverride?: string | null }>;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const progress: ExportProgressEvent[] = [];
  const emitted: SyncStatusPayload[] = [];
  const renamed: Array<[string, string]> = [];
  const removed: string[] = [];
  const latched = new Set<string>();
  const syncArgs: unknown[] = [];
  const buildArgs: Array<{ outDir?: string; pdfFileOverride?: string | null }> = [];
  const counters = { sync: 0, build: 0 };
  let session: ExportSession | null = opts.activeSession ?? null;

  const lib = {
    detectProjectSource: async () => ({ type: opts.sourceType ?? "local-folder" }),
    diagnoseProjectRemote: async () => ({ canSync: opts.canSync ?? false }),
    syncProject: async (args: unknown) => {
      counters.sync += 1;
      syncArgs.push(args);
      if (opts.cancelDuringSync && session) session.canceled = true;
      return opts.syncProject ? opts.syncProject() : { status: "up-to-date" };
    },
    runBuild: async (buildOpts: { outDir?: string; pdfFileOverride?: string | null }) => {
      counters.build += 1;
      buildArgs.push(buildOpts);
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
    gitIdentity: async () => opts.gitIdentity ?? {},
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
    consumeSavePath: opts.consumeSavePath ?? (() => true),
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
    syncArgs,
    buildArgs,
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

// ── workspace/destination split (bug fix) ───────────────────────────────────
// Previously `outDir` (where `runBuild` writes book.html, assets, and
// build-fingerprint.json) was derived from the SAME folder as the user's
// chosen Save path via `lib.splitOutPath`, so a PDF export silently dropped
// the whole build workspace next to it (e.g. onto the Desktop), overwriting
// same-named files. `outDir` must now be an OS-temp workspace, decoupled from
// the Save folder, cleaned up once the export settles; only the PDF
// (`pdfFileOverride`, which sits next to the chosen destination for an
// atomic same-filesystem rename) may end up in the folder the user picked.
test("the build workspace is a temp dir decoupled from the Save folder, and is cleaned up", async () => {
  const h = makeHarness();
  await h.controller.build({ input: "/book", format: "pdf", out: "/Users/author/Desktop/MyBook.pdf" });

  expect(h.buildArgs.length).toBe(1);
  const { outDir, pdfFileOverride } = h.buildArgs[0]!;
  expect(outDir).toBeTruthy();
  expect(outDir).not.toBe("/Users/author/Desktop");
  expect(path.dirname(outDir!)).not.toBe("/Users/author/Desktop");
  // The PDF itself still lands next to the chosen destination.
  expect(pdfFileOverride).toBeTruthy();
  expect(path.dirname(pdfFileOverride!)).toBe("/Users/author/Desktop");
  // The workspace is temp scratch space — removed once the export settles.
  expect(existsSync(outDir!)).toBe(false);
});

test("the workspace is still cleaned up when the pre-export sync gate hard-blocks", async () => {
  // The gate throws before runBuild ever runs, so `buildArgs` never captures
  // the workspace path — assert cleanup indirectly instead, by checking no
  // `print-md-export-*` temp dir this run created is left behind afterward.
  // This is exactly the path an earlier version of the fix got wrong: the
  // mkdtemp'd workspace was created BEFORE the sync gate, and the gate's own
  // early `throw` (SYNC_CONFLICT) exited past a `finally` that only wrapped
  // the build step, leaking the workspace on every hard-blocked export.
  const before = new Set(
    readdirSync(os.tmpdir()).filter((n) => n.startsWith("print-md-export-")),
  );
  const h = makeHarness({ conflictLatched: true });
  const err = await h.controller
    .build({ input: "/book", out: "/out/book.pdf" })
    .catch((e) => e);

  expect((err as Error & { code?: string }).code).toBe("SYNC_CONFLICT");
  expect(h.runBuildCalls).toBe(0);
  const after = readdirSync(os.tmpdir()).filter((n) => n.startsWith("print-md-export-"));
  expect(after.filter((n) => !before.has(n))).toEqual([]);
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

// ── finding #4 (2026-07-13 maintainer review): PDF export accepts arbitrary
//    output paths — `out` must be a one-time capability the Save dialog
//    itself registered, not merely any renderer-supplied absolute path ──────

test("an 'out' never issued by the Save dialog is rejected with OUT_NOT_AUTHORIZED, before any work happens", async () => {
  const h = makeHarness({ consumeSavePath: () => false });
  const err = await h.controller
    .build({ input: "/book", out: "/etc/passwd" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("OUT_NOT_AUTHORIZED");
  // No session was minted, no progress emitted, no build/rename attempted —
  // the check runs before any of that side-effecting work.
  expect(h.getSession()).toBeNull();
  expect(h.progress.length).toBe(0);
  expect(h.runBuildCalls).toBe(0);
  expect(h.renamed.length).toBe(0);
});

test("an 'out' the Save dialog registered is consumed exactly once — a replay of the same 'out' is rejected", async () => {
  const authorized = new Set(["/out/book.pdf"]);
  const consumeSavePath = (absPath: string) => authorized.delete(absPath);
  const h = makeHarness({ consumeSavePath });

  const res = await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  expect(res.pdfPath).toBe("/out/book.pdf");

  // Same 'out', no fresh Save dialog round-trip — the capability was already
  // spent by the first build, so a second attempt (e.g. a script replaying
  // the same api:build call) must not silently succeed.
  const err = await h.controller
    .build({ input: "/book", out: "/out/book.pdf" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("OUT_NOT_AUTHORIZED");
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

test("the pre-export sync gate commits with the configured name + email", async () => {
  // syncProject snapshots-first, so the gate writes a commit. It must carry the
  // author's identity like the manual "Save a version" path does.
  const h = makeHarness({
    sourceType: "local-git-folder",
    canSync: true,
    isOnline: true,
    gitIdentity: { authorName: "Ada Lovelace", authorEmail: "ada@example.com" },
  });
  await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  expect(h.syncArgs.length).toBe(1);
  expect(h.syncArgs[0]).toMatchObject({
    projectDir: "/book",
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
  });
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

// ── M28: the exportId is minted and the session registered as active BEFORE
//    the pre-export sync gate runs, so Cancel is live immediately ───────────

test("mints the exportId and registers the active session before the gate's network work (M28)", async () => {
  let sessionDuringGate: ExportSession | null | undefined;
  const h = makeHarness({
    sourceType: "local-git-folder",
    canSync: true,
    isOnline: true,
    syncProject: () => {
      sessionDuringGate = h.getSession();
      return { status: "up-to-date" };
    },
  });
  await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  expect(sessionDuringGate).not.toBeNull();
  expect(sessionDuringGate?.id).toBeTruthy();
});

test("sends a pre-gate 'started' progress event with a syncing message before any gate work (M28)", async () => {
  const h = makeHarness({
    sourceType: "local-git-folder",
    canSync: true,
    isOnline: true,
  });
  await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  // First event: the pre-gate one, minted before isConflictLatched/detectProjectSource
  // even run. Still `state: "started"` (ExportProgressEvent's union is
  // unchanged end-to-end) — distinguished by its message.
  expect(h.progress[0]?.state).toBe("started");
  expect(h.progress[0]?.message).toMatch(/sync/i);
  // The real build-start "started" event follows, with no message.
  const realStarted = h.progress.find((p, i) => i > 0 && p.state === "started");
  expect(realStarted).toBeDefined();
  expect(realStarted?.message).toBeUndefined();
});

test("Cancel during the pre-export sync gate aborts before runBuild (M28)", async () => {
  const h = makeHarness({
    sourceType: "local-git-folder",
    canSync: true,
    isOnline: true,
    cancelDuringSync: true,
  });
  const err = await h.controller
    .build({ input: "/book", out: "/out/book.pdf" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("EXPORT_CANCELED");
  expect(h.runBuildCalls).toBe(0);
  expect(h.progress.some((p) => p.state === "canceled")).toBe(true);
  // Session cleaned up so a subsequent export isn't blocked.
  expect(h.getSession()).toBeNull();
});
