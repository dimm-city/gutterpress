import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { explainBuildFailure, renderPhases, type EngineBrowser } from "gutterpress";
import { ExportController, type ExportControllerDeps } from "../../electron/export/controller";
import { cancelExportSession, type ExportProgressEvent, type ExportSession } from "../../electron/pdf-export";
import type { SyncStatusPayload } from "../../electron/auto-sync/orchestrator";

type LibModule = typeof import("gutterpress");

interface HarnessOpts {
  sourceType?: string;
  canSync?: boolean;
  isOnline?: boolean;
  /** Return value (or thrown value) of the fake syncProject during the export gate. */
  syncProject?: () => unknown;
  /** Return value (or thrown value) of the fake runBuild; given the browser factory it was handed. */
  runBuild?: (engineBrowser: () => Promise<EngineBrowser>, buildOpts: BuildCall) => unknown;
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
   * Fake for the in-project containment check. Defaults to "never inside",
   * so the save-path capability alone decides, as before.
   */
  isWithinProject?: (absPath: string) => Promise<boolean>;
  /**
   * Flips the (by-then-minted) active session's `canceled` flag while
   * syncProject is in flight — simulates a Cancel click landing during the
   * pre-export sync gate (M28).
   */
  cancelDuringSync?: boolean;
  /** The author's configured commit identity the pre-export sync gate must pass on. */
  gitIdentity?: { authorName?: string; authorEmail?: string };
  /** The window the render opens. */
  engineBrowser?: () => Promise<EngineBrowser>;
}

type BuildCall = {
  outDir?: string;
  pdfFileOverride?: string | null;
  allowShrink?: boolean;
  format?: string;
  skipPreValidate?: boolean;
  skipPostValidate?: boolean;
  engineBrowser: () => Promise<EngineBrowser>;
  signal?: AbortSignal;
};

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
  buildArgs: BuildCall[];
  /** Paths handed to `registerPickedPath`, in order (the reveal capability). */
  registeredPicks: string[];
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const progress: ExportProgressEvent[] = [];
  const emitted: SyncStatusPayload[] = [];
  const renamed: Array<[string, string]> = [];
  const removed: string[] = [];
  const latched = new Set<string>();
  const syncArgs: unknown[] = [];
  const buildArgs: BuildCall[] = [];
  const registeredPicks: string[] = [];
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
    runBuild: async (buildOpts: BuildCall) => {
      counters.build += 1;
      buildArgs.push(buildOpts);
      return opts.runBuild ? opts.runBuild(buildOpts.engineBrowser, buildOpts) : { outDir: "/out", diagnostics: [] };
    },
    // The lib's own: what a failure is called, and the render's phases.
    explainBuildFailure,
    renderPhases,
  } as unknown as LibModule;

  const deps: ExportControllerDeps = {
    loadLib: async () => lib,
    tokenStore: {} as ExportControllerDeps["tokenStore"],
    gitIdentity: async () => opts.gitIdentity ?? {},
    isOnline: () => opts.isOnline ?? true,
    pdfRenderer: (async () => {}) as ExportControllerDeps["pdfRenderer"],
    engineBrowser: opts.engineBrowser ?? ((async () => ({}) as never) as ExportControllerDeps["engineBrowser"]),
    getActiveExportSession: () => session,
    setActiveExportSession: (s) => {
      session = s;
    },
    sendProgress: (e) => {
      progress.push(e);
    },
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
    isWithinProject: opts.isWithinProject ?? (async () => false),
    registerPickedPath: (absPath: string) => {
      registeredPicks.push(absPath);
    },
  };

  return {
    controller: new ExportController(deps),
    progress,
    emitted,
    renamed,
    registeredPicks,
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
  const res = await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  // A plain PDF, as `gutterpress build` makes one: the book's source is
  // checked first (checks are on by default).
  expect(h.buildArgs[0]).toMatchObject({ format: "pdf" });
  expect(h.buildArgs[0]?.skipPreValidate).toBeUndefined();

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

// ── workspace/destination split ─────────────────────────────────────────────
// `outDir` (where `runBuild` writes book.html, assets, and
// build-fingerprint.json) must not be the user's chosen Save folder, or a PDF
// export drops the whole build workspace next to it (e.g. onto the Desktop),
// overwriting same-named files. `outDir` must be an OS-temp workspace, decoupled from
// the Save folder, cleaned up once the export settles; only the PDF
// (`pdfFileOverride`, which sits next to the chosen destination for an
// atomic same-filesystem rename) may end up in the folder the user picked.
test("the build workspace is a temp dir decoupled from the Save folder, and is cleaned up", async () => {
  const h = makeHarness();
  await h.controller.build({ input: "/book", out: "/Users/author/Desktop/MyBook.pdf" });

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

// #163: the desktop is the only export path a non-technical author has, so
// the engine's `allowShrink` escape hatch has to survive the whole way down —
// renderer BuildArgs → RawBuildArgs → api:build → here → runBuild. Drop this
// forwarding and the renderer's "Build anyway" button fails exactly the same
// way the export it is retrying did.
test("allowShrink reaches the lib build, and stays off unless asked for", async () => {
  const h = makeHarness();
  await h.controller.build({ input: "/book", out: "/out/book.pdf", allowShrink: true });
  expect(h.buildArgs[0]!.allowShrink).toBe(true);

  const h2 = makeHarness();
  await h2.controller.build({ input: "/book", out: "/out/book.pdf" });
  expect(h2.buildArgs[0]!.allowShrink).toBeFalsy();
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

// ── `out` must be a one-time capability the Save dialog itself registered,
//    not merely any renderer-supplied absolute path ──────────────────────────

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

// ── Publish wizard: building into a folder inside the open book ────────────

test("an 'out' inside the open book builds without any save-path grant", async () => {
  const h = makeHarness({
    consumeSavePath: () => false,
    isWithinProject: async (p) => p.startsWith("/book/"),
  });
  const res = await h.controller.build({ input: "/book", out: "/book/dist/book.pdf" });
  expect(res.pdfPath).toBe("/book/dist/book.pdf");
  expect(h.runBuildCalls).toBe(1);
});

test("an 'out' outside the open book with no grant is refused with OUT_NOT_AUTHORIZED", async () => {
  const h = makeHarness({
    consumeSavePath: () => false,
    isWithinProject: async (p) => p.startsWith("/book/"),
  });
  const err = await h.controller
    .build({ input: "/book", out: "/home/author/elsewhere/book.pdf" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("OUT_NOT_AUTHORIZED");
  expect(h.getSession()).toBeNull();
  expect(h.progress.length).toBe(0);
  expect(h.runBuildCalls).toBe(0);
});

// ── the reveal capability for the written PDF ────────────

test("a successful export registers the written PDF so 'Show in Folder' can reveal it", async () => {
  // `shell/show-in-folder` confines its target to the open project plus the
  // read-only roots — but the export destination is deliberately OUTSIDE the
  // project (wherever the author pointed the Save dialog). The host records
  // the path it actually wrote, so the reveal is authorized without the route
  // ever trusting a renderer-supplied path.
  const h = makeHarness();
  await h.controller.build({ input: "/book", out: "/home/author/Desktop/book.pdf" });
  expect(h.registeredPicks).toEqual(["/home/author/Desktop/book.pdf"]);
});

test("a FAILED export registers nothing (no reveal capability for a PDF never written)", async () => {
  const h = makeHarness({
    runBuild: () => {
      throw new Error("render blew up");
    },
  });
  await h.controller.build({ input: "/book", out: "/home/author/Desktop/book.pdf" }).catch(() => {});
  expect(h.registeredPicks).toEqual([]);
});

test("a second concurrent export is rejected while one is active", async () => {
  const active: ExportSession = {
    id: "x",
    canceled: false,
    outPath: "/o",
    tempOutPath: "/o.tmp",
    abort: new AbortController(),
  };
  const h = makeHarness({ activeSession: active });
  await expect(
    h.controller.build({ input: "/book", out: "/out/book.pdf" }),
  ).rejects.toThrow(/already in progress/);
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
    // Getting the latest changes only: an export never sends the book anywhere.
    push: false,
  });
});

// A failure crosses with the lib's code, its plain sentence and the original
// text (ADR 0012): the app acts on the code (TOO_WIDE offers "Build anyway")
// and never reads the message to decide what it means.
test("a failed build says why in the lib's words, with its code and the original text", async () => {
  const h = makeHarness({
    runBuild: () => {
      throw Object.assign(new Error("content wider than the page content box"), {
        code: "TOO_WIDE",
        offenders: ["div.wide"],
        scale: 0.69,
      });
    },
  });
  const err = (await h.controller.build({ input: "/book", out: "/out/book.pdf" }).catch((e) => e)) as Error & {
    code?: string;
    detail?: string;
  };
  expect(err.code).toBe("TOO_WIDE");
  expect(err.message).toStartWith("Too wide for the page: div.wide.");
  expect(err.detail).toBe("content wider than the page content box");
  expect(h.progress.at(-1)).toMatchObject({ state: "error", message: err.message });
  // session cleaned up even on failure
  expect(h.getSession()).toBeNull();
});

test("a failure the lib has no words of its own for still says the build's reason", async () => {
  const h = makeHarness({
    runBuild: () => {
      throw new Error("gs exited with code 1");
    },
  });
  const err = (await h.controller.build({ input: "/book", out: "/out/book.pdf" }).catch((e) => e)) as Error & {
    code?: string;
  };
  expect(err.code).toBe("BUILD_FAILED");
  expect(err.message).toBe("Making the PDF failed: gs exited with code 1");
});

// The pill says more than a ticking clock: the render's phases, as the lib
// reports them, reach it as the export's own wire states.
test("the render's phases reach the window as rendering, then finalizing, once each", async () => {
  const page = () => ({ navigate: async () => {}, printToPDF: async () => new Uint8Array() });
  const h = makeHarness({
    runBuild: async (engineBrowser) => {
      const browser = await engineBrowser();
      const main = await browser.newPage();
      await main.navigate("file:///book.html");
      // A second page laid out before the main one prints.
      const predict = await browser.newPage();
      await predict.navigate("file:///book.html");
      await main.printToPDF({} as never);
      await predict.navigate("file:///book.html");
      return { outDir: "/out", diagnostics: [] };
    },
    engineBrowser: async () => ({ newPage: async () => page() }) as never,
  });
  await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  expect(h.progress.map((p) => p.state).filter((s) => s === "rendering" || s === "finalizing")).toEqual([
    "rendering",
    "finalizing",
  ]);
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

test("sends a pre-gate 'started' event at once, and labels the wait only when it will get the latest changes (M28)", async () => {
  const h = makeHarness({
    sourceType: "local-git-folder",
    canSync: true,
    isOnline: true,
  });
  await h.controller.build({ input: "/book", out: "/out/book.pdf" });
  // First event: minted before any gate work, so Cancel is live. Still
  // `state: "started"` (ExportProgressEvent's union is unchanged end-to-end).
  expect(h.progress[0]?.state).toBe("started");
  expect(h.progress[0]?.message).toBeUndefined();
  // Then the label for the wait, which only a book that gets the latest changes sees…
  expect(h.progress[1]).toMatchObject({ state: "started", message: "Getting the latest changes…" });
  // …and the real build-start "started" event, with no message.
  const realStarted = h.progress.find((p, i) => i > 1 && p.state === "started");
  expect(realStarted).toBeDefined();
  expect(realStarted?.message).toBeUndefined();
});

test("a book that cannot get the latest changes is never told it is waiting for them", async () => {
  for (const opts of [
    { sourceType: "local-folder" },
    { sourceType: "local-git-folder", canSync: false, isOnline: true },
    { sourceType: "local-git-folder", canSync: true, isOnline: false },
  ]) {
    const h = makeHarness(opts);
    await h.controller.build({ input: "/book", out: "/out/book.pdf" });
    expect(h.progress.some((p) => /latest changes/i.test(p.message ?? ""))).toBe(false);
    expect(h.syncArgs.length).toBe(0);
  }
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

/** A render that stops, as the lib's runBuild does, when its signal aborts. */
const renderUntilCanceled = (_browser: unknown, buildOpts: BuildCall) =>
  new Promise((_resolve, reject) => {
    buildOpts.signal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("The build was canceled"), { code: "CANCELED" })),
    );
  });

async function until(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`never happened: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("Cancel during the render stops the render, settles as canceled, and the next export is accepted", async () => {
  const h = makeHarness({ runBuild: renderUntilCanceled });
  const first = h.controller.build({ input: "/book", out: "/out/book.pdf" }).catch((e) => e);
  await until("the render starts", () => h.runBuildCalls === 1);

  const started = Date.now();
  cancelExportSession(h.getSession()!);
  const err = await first;
  expect((err as Error & { code?: string }).code).toBe("EXPORT_CANCELED");
  expect(Date.now() - started).toBeLessThan(2000);
  expect(h.progress.some((p) => p.state === "canceled")).toBe(true);
  expect(h.renamed).toEqual([]);
  // The slot is free: a second export starts instead of being refused.
  expect(h.getSession()).toBeNull();
  const second = h.controller.build({ input: "/book", out: "/out/book.pdf" }).catch((e) => e);
  await until("the second render starts", () => h.runBuildCalls === 2);
  cancelExportSession(h.getSession()!);
  expect(((await second) as Error & { code?: string }).code).toBe("EXPORT_CANCELED");
}, 8000);
