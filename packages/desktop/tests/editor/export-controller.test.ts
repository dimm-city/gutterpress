import { expect, test } from "bun:test";
import { ExportController } from "../../src/lib/export/export-controller.svelte";
import type { ExportHostDeps, ExportProgressEvent } from "../../src/lib/export/export-controller.svelte";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** A controllable fake clock standing in for the 1s ticker's setInterval. */
class FakeInterval {
  private cb: (() => void) | null = null;
  cleared = false;
  handle = { id: 1 };

  seam() {
    return {
      setInterval: (cb: () => void, _ms: number) => {
        this.cb = cb;
        this.cleared = false;
        return this.handle;
      },
      clearInterval: (h: unknown) => {
        if (h === this.handle) {
          this.cleared = true;
          this.cb = null;
        }
      },
    };
  }

  /** Advance the fake clock by `n` one-second ticks. */
  tick(n = 1) {
    for (let i = 0; i < n; i++) this.cb?.();
  }

  get running(): boolean {
    return this.cb !== null && !this.cleared;
  }
}

function makeController(): { ctrl: ExportController; clock: FakeInterval } {
  const clock = new FakeInterval();
  return { ctrl: new ExportController(clock.seam()), clock };
}

const ev = (over: Partial<ExportProgressEvent> = {}): ExportProgressEvent => ({
  exportId: "exp-1",
  state: "rendering",
  ...over,
});

test("start() enters the started state, resets counters, and runs the ticker", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  expect(ctrl.exporting).toBe(true);
  expect(ctrl.state).toBe("started");
  expect(ctrl.pages).toBe(0);
  expect(ctrl.elapsedSeconds).toBe(0);
  expect(ctrl.pdfProgress).toBe("Preparing PDF…");
  expect(clock.running).toBe(true);
});

test("elapsed seconds only appear in the label once >= 3s", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(2);
  expect(ctrl.elapsedSeconds).toBe(2);
  // Below 3s: no seconds suffix.
  expect(ctrl.pdfProgress).toBe("Preparing PDF…");
  clock.tick(1);
  expect(ctrl.elapsedSeconds).toBe(3);
  expect(ctrl.pdfProgress).toBe("Preparing PDF… 3s");
});

test("syncProgress adopts the first exportId and folds in state + pages", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ state: "rendering", pages: 5 }));
  expect(ctrl.activeExportId).toBe("exp-1");
  expect(ctrl.state).toBe("rendering");
  expect(ctrl.pages).toBe(5);
  expect(ctrl.pdfProgress).toBe("Exporting page 5…");

  ctrl.syncProgress(ev({ state: "finalizing", pages: 12 }));
  expect(ctrl.state).toBe("finalizing");
  expect(ctrl.pdfProgress).toBe("Finalizing PDF (12 pages)…");
});

test("syncProgress ignores events from a different export id", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "rendering", pages: 3 }));
  ctrl.syncProgress(ev({ exportId: "OTHER", state: "finalizing", pages: 99 }));
  // Stale event ignored: state/pages unchanged.
  expect(ctrl.state).toBe("rendering");
  expect(ctrl.pages).toBe(3);
});

test("rendering/finalizing labels fall back when no page count is known", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ state: "rendering" }));
  expect(ctrl.pdfProgress).toBe("Exporting…");
  ctrl.syncProgress(ev({ state: "finalizing" }));
  expect(ctrl.pdfProgress).toBe("Finalizing PDF…");
});

test("markCanceling shows a fixed label with no elapsed suffix", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(5);
  ctrl.markCanceling();
  expect(ctrl.state).toBe("canceling");
  expect(ctrl.pdfProgress).toBe("Canceling export…");
});

test("markSuccess stops the ticker, records the export id, and shows PDF saved", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(4);
  ctrl.markSuccess("exp-final");
  expect(ctrl.state).toBe("success");
  expect(ctrl.activeExportId).toBe("exp-final");
  expect(clock.running).toBe(false);
  // Elapsed was 4s at success → suffix retained.
  expect(ctrl.pdfProgress).toBe("PDF saved 4s");
});

test("markSuccess without an id keeps a previously adopted export id", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "rendering" }));
  ctrl.markSuccess();
  expect(ctrl.activeExportId).toBe("exp-1");
  expect(ctrl.state).toBe("success");
});

test("reset returns everything to idle and clears the ticker", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(3);
  ctrl.syncProgress(ev({ state: "rendering", pages: 7 }));
  ctrl.reset();
  expect(ctrl.exporting).toBe(false);
  expect(ctrl.activeExportId).toBe(null);
  expect(ctrl.state).toBe("idle");
  expect(ctrl.pages).toBe(0);
  expect(ctrl.elapsedSeconds).toBe(0);
  expect(ctrl.pdfProgress).toBe(null);
  expect(clock.running).toBe(false);
});

test("beginSimpleExport/endSimpleExport toggle only the busy flag (HTML path)", () => {
  const { ctrl, clock } = makeController();
  ctrl.beginSimpleExport();
  expect(ctrl.exporting).toBe(true);
  // No FSM/timer engaged for the simple path.
  expect(ctrl.state).toBe("idle");
  expect(ctrl.pdfProgress).toBe(null);
  expect(clock.running).toBe(false);
  ctrl.endSimpleExport();
  expect(ctrl.exporting).toBe(false);
});

// ── M27: start() must clear a stale activeExportId ──────────────────────────

test("start() clears any previously adopted activeExportId (M27 — prevents cross-wiring two exports)", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "rendering" }));
  expect(ctrl.activeExportId).toBe("exp-1");
  ctrl.markSuccess();
  // A second export begins (a keyboard shortcut fired again before the pill
  // tore down) — start() must clear the stale id, or export B's progress
  // events would be silently dropped by the id filter in syncProgress, and
  // Cancel would keep targeting export A.
  ctrl.start();
  expect(ctrl.activeExportId).toBe(null);
});

// ── M28: pre-gate "started" + message shows a syncing label that survives
//    the ticker, and reverts once the real build-start event arrives ────────

test("a pre-gate 'started' event with a message shows that message and adopts the id (M28)", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "started", message: "Syncing latest changes…" }));
  expect(ctrl.activeExportId).toBe("exp-1");
  expect(ctrl.pdfProgress).toBe("Syncing latest changes…");
  // The 1s ticker must not clobber the syncing message with the elapsed-time
  // label — this is exactly the bug the ticker's unconditional updateLabel()
  // call would otherwise reintroduce.
  clock.tick(4);
  expect(ctrl.pdfProgress).toBe("Syncing latest changes…");

  // The real build-start event (no message) reverts to the normal label.
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "started" }));
  expect(ctrl.pdfProgress).toMatch(/^Preparing PDF…/);
});

test("markCanceling during the syncing phase shows Canceling…, not the stale sync message", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "started", message: "Syncing latest changes…" }));
  ctrl.markCanceling();
  expect(ctrl.pdfProgress).toBe("Canceling export…");
});


// ─────────────────────────────────────────────────────────────────────────────
// Host intents: savePdf / exportHtml / cancelExport (Phase 5 slice 2 — moved
// from +page.svelte, UX H5 / ARCH #10).
// ─────────────────────────────────────────────────────────────────────────────

type Spy<A extends unknown[] = unknown[]> = ((...a: A) => void) & { calls: A[] };
const hspy = <A extends unknown[] = unknown[]>(): Spy<A> => {
  const fn = ((...a: A) => {
    fn.calls.push(a);
  }) as Spy<A>;
  fn.calls = [];
  return fn;
};

interface HostHarness {
  ctrl: ExportController;
  host: ExportHostDeps;
  deps: {
    isDesktop: Spy<[]> & { value: boolean };
    checkSaveReadiness: Spy<[]> & { value: string | null };
    setSaveWarning: Spy<[string | null]>;
    currentDir: Spy<[]> & { value: string | null };
    displayName: Spy<[]> & { value: string | null };
    isBusy: Spy<[]> & { value: boolean };
    sourceMode: Spy<[]> & { value: "folder" | "url" };
    chooseSavePath: Spy<[string]> & { value: string | null };
    buildPdf: Spy<[{ key: string; displayName: string }, string]> & {
      impl: () => Promise<{ exportId?: string; pdfPath?: string }>;
    };
    buildHtml: Spy<[{ key: string; displayName: string }]> & {
      impl: () => Promise<{ downloadUrl?: string }>;
    };
    cancelExportHost: Spy<[string]>;
    downloadFile: Spy<[string, string]>;
    showInFolder: Spy<[string]>;
    toastSuccess: Spy<[string, (number | undefined)?, ({ label: string; onClick: () => void } | undefined)?]>;
    toastError: Spy<[string]>;
    wait: Spy<[number]>;
  };
}

function makeHostController(): HostHarness {
  const isDesktop = Object.assign(hspy<[]>(), { value: true });
  const checkSaveReadiness = Object.assign(hspy<[]>(), { value: null as string | null });
  const setSaveWarning = hspy<[string | null]>();
  const currentDir = Object.assign(hspy<[]>(), { value: "/proj" as string | null });
  const displayName = Object.assign(hspy<[]>(), { value: "My Book" as string | null });
  const isBusy = Object.assign(hspy<[]>(), { value: false });
  const sourceMode = Object.assign(hspy<[]>(), { value: "folder" as "folder" | "url" });
  const chooseSavePath = Object.assign(hspy<[string]>(), { value: "/out/book.pdf" as string | null });
  const buildPdf = Object.assign(hspy<[{ key: string; displayName: string }, string]>(), {
    impl: async () => ({ exportId: "exp-1", pdfPath: "/out/book.pdf" }),
  });
  const buildHtml = Object.assign(hspy<[{ key: string; displayName: string }]>(), {
    impl: async () => ({ downloadUrl: "blob:abc" }),
  });
  const cancelExportHost = hspy<[string]>();
  const downloadFile = hspy<[string, string]>();
  const showInFolder = hspy<[string]>();
  const toastSuccess = hspy<[string, (number | undefined)?, ({ label: string; onClick: () => void } | undefined)?]>();
  const toastError = hspy<[string]>();
  const wait = hspy<[number]>();

  const host: ExportHostDeps = {
    isDesktop: () => {
      isDesktop();
      return isDesktop.value;
    },
    desktopRequiredMessage: "This needs the desktop app to continue.",
    checkSaveReadiness: () => {
      checkSaveReadiness();
      return checkSaveReadiness.value;
    },
    setSaveWarning: (m) => setSaveWarning(m),
    currentDir: () => {
      currentDir();
      return currentDir.value;
    },
    displayName: () => {
      displayName();
      return displayName.value;
    },
    isBusy: () => {
      isBusy();
      return isBusy.value;
    },
    sourceMode: () => {
      sourceMode();
      return sourceMode.value;
    },
    chooseSavePath: (defaultName) => {
      chooseSavePath(defaultName);
      return Promise.resolve(chooseSavePath.value);
    },
    onBuildProgress: () => undefined,
    buildPdf: (input, outPath) => {
      buildPdf(input, outPath);
      return buildPdf.impl();
    },
    buildHtml: (input) => {
      buildHtml(input);
      return buildHtml.impl();
    },
    cancelExportHost: (id) => {
      cancelExportHost(id);
      return Promise.resolve();
    },
    downloadFile: (url, filename) => downloadFile(url, filename),
    showInFolder: (path) => {
      showInFolder(path);
      return Promise.resolve();
    },
    toastSuccess: (m, d, a) => toastSuccess(m, d, a),
    toastError: (m) => toastError(m),
    friendlyPdfError: (e) => `friendly: ${e instanceof Error ? e.message : String(e)}`,
    wait: (ms) => {
      wait(ms);
      return Promise.resolve();
    },
  };

  return {
    ctrl: new ExportController(undefined, host),
    host,
    deps: {
      isDesktop,
      checkSaveReadiness,
      setSaveWarning,
      currentDir,
      displayName,
      isBusy,
      sourceMode,
      chooseSavePath,
      buildPdf,
      buildHtml,
      cancelExportHost,
      downloadFile,
      showInFolder,
      toastSuccess,
      toastError,
      wait,
    },
  };
}

// ── savePdf ──────────────────────────────────────────────────────────────────

test("savePdf() calling methods without host deps throws a clear error", async () => {
  const ctrl = new ExportController();
  await expect(ctrl.savePdf()).rejects.toThrow(/host deps required/);
});

test("savePdf() no-ops when an export is already in flight (M27's one guard)", async () => {
  const { ctrl, deps } = makeHostController();
  ctrl.start(); // exporting = true
  await ctrl.savePdf();
  expect(deps.checkSaveReadiness.calls.length).toBe(0);
});

test("savePdf() always assigns the readiness warning (even null, clearing a stale one), and stops when truthy", async () => {
  const { ctrl, deps } = makeHostController();
  deps.checkSaveReadiness.value = "Your document is still loading.";
  await ctrl.savePdf();
  expect(deps.setSaveWarning.calls).toEqual([["Your document is still loading."]]);
  expect(deps.chooseSavePath.calls.length).toBe(0);
});

test("savePdf() with no current dir stops after clearing the warning", async () => {
  const { ctrl, deps } = makeHostController();
  deps.currentDir.value = null;
  await ctrl.savePdf();
  expect(deps.setSaveWarning.calls).toEqual([[null]]);
  expect(deps.chooseSavePath.calls.length).toBe(0);
});

test("savePdf() on the web shows the desktop-required toast instead of exporting", async () => {
  const { ctrl, deps } = makeHostController();
  deps.isDesktop.value = false;
  await ctrl.savePdf();
  expect(deps.toastError.calls).toEqual([["This needs the desktop app to continue."]]);
  expect(deps.chooseSavePath.calls.length).toBe(0);
});

test("savePdf() default filename prefers displayName, falls back to basename", async () => {
  const { ctrl, deps } = makeHostController();
  deps.displayName.value = null;
  deps.currentDir.value = "/home/writer/My Great Book";
  await ctrl.savePdf();
  expect(deps.chooseSavePath.calls[0]![0]).toBe("My Great Book.pdf");
});

test("savePdf() canceling the save dialog leaves the FSM idle (no start())", async () => {
  const { ctrl, deps } = makeHostController();
  deps.chooseSavePath.value = null;
  await ctrl.savePdf();
  expect(ctrl.exporting).toBe(false);
  expect(ctrl.state).toBe("idle");
  expect(deps.buildPdf.calls.length).toBe(0);
});

test("savePdf() happy path: starts the FSM, builds, marks success, toasts with a Show-in-Folder action, waits, then resets", async () => {
  const { ctrl, deps } = makeHostController();
  await ctrl.savePdf();
  expect(deps.buildPdf.calls[0]![0]).toEqual({ key: "/proj", displayName: "My Book" });
  expect(deps.buildPdf.calls[0]![1]).toBe("/out/book.pdf");
  expect(deps.toastSuccess.calls[0]![0]).toBe("PDF saved to /out/book.pdf");
  const action = deps.toastSuccess.calls[0]![2];
  action?.onClick();
  expect(deps.showInFolder.calls).toEqual([["/out/book.pdf"]]);
  expect(deps.wait.calls).toEqual([[2000]]);
  // Fully reset back to idle at the end.
  expect(ctrl.exporting).toBe(false);
  expect(ctrl.state).toBe("idle");
});

test("savePdf() onBuildProgress dispatch: 'canceled' marks canceling, 'error' is ignored, everything else folds into the FSM", async () => {
  const { host } = makeHostController();
  let feed: ((e: ExportProgressEvent) => void) | undefined;
  host.onBuildProgress = (cb) => {
    feed = cb;
    return () => {};
  };
  // Hold buildPdf open until the test has fed progress events, so the
  // onBuildProgress subscription (registered before the build call) has
  // definitely happened by the time we assert on it.
  let resolveBuild!: (v: { exportId?: string; pdfPath?: string }) => void;
  host.buildPdf = () => new Promise((resolve) => (resolveBuild = resolve));
  const ctrl2 = new ExportController(undefined, host);
  const p = ctrl2.savePdf();
  await Promise.resolve(); // let the dialog-choice + subscribe microtasks settle
  await Promise.resolve();
  expect(feed).toBeDefined();
  feed!({ exportId: "exp-1", state: "rendering", pages: 3 });
  expect(ctrl2.state).toBe("rendering");
  expect(ctrl2.pages).toBe(3);
  feed!({ exportId: "exp-1", state: "canceled" as ExportProgressEvent["state"] });
  expect(ctrl2.state).toBe("canceling");
  resolveBuild({ exportId: "exp-1", pdfPath: "/out/book.pdf" });
  await p;
});

test("savePdf() a non-EXPORT_CANCELED failure toasts the friendly error and resets", async () => {
  const { ctrl, deps } = makeHostController();
  deps.buildPdf.impl = () => Promise.reject(new Error("disk full"));
  await ctrl.savePdf();
  expect(deps.toastError.calls).toEqual([["friendly: disk full"]]);
  expect(ctrl.state).toBe("idle");
  expect(ctrl.exporting).toBe(false);
});

test("savePdf() EXPORT_CANCELED resets quietly without an error toast", async () => {
  const { ctrl, deps } = makeHostController();
  const err = Object.assign(new Error("canceled"), { code: "EXPORT_CANCELED" });
  deps.buildPdf.impl = () => Promise.reject(err);
  await ctrl.savePdf();
  expect(deps.toastError.calls.length).toBe(0);
  expect(ctrl.state).toBe("idle");
});

// ── exportHtml ───────────────────────────────────────────────────────────────

test("exportHtml() no-ops with no current dir, while busy, while already exporting, or in URL mode", async () => {
  const cases: Array<(d: HostHarness["deps"], c: ExportController) => void> = [
    (d) => (d.currentDir.value = null),
    (d) => (d.isBusy.value = true),
    (_d, c) => c.beginSimpleExport(),
    (d) => (d.sourceMode.value = "url"),
  ];
  for (const setup of cases) {
    const { ctrl, deps } = makeHostController();
    setup(deps, ctrl);
    const before = deps.buildHtml.calls.length;
    await ctrl.exportHtml();
    expect(deps.buildHtml.calls.length).toBe(before);
  }
});

test("exportHtml() happy path: downloads the file and toasts success, then clears the busy flag", async () => {
  const { ctrl, deps } = makeHostController();
  await ctrl.exportHtml();
  expect(deps.downloadFile.calls).toEqual([["blob:abc", "My Book.html"]]);
  expect(deps.toastSuccess.calls).toEqual([["HTML exported"]]);
  expect(ctrl.exporting).toBe(false);
});

test("exportHtml() with no downloadUrl toasts a specific failure instead of silently no-opping (M22)", async () => {
  const { ctrl, deps } = makeHostController();
  deps.buildHtml.impl = async () => ({});
  await ctrl.exportHtml();
  expect(deps.toastError.calls).toEqual([["HTML export failed: no file was produced."]]);
  expect(deps.downloadFile.calls.length).toBe(0);
});

test("exportHtml() build failure toasts the friendly error", async () => {
  const { ctrl, deps } = makeHostController();
  deps.buildHtml.impl = () => Promise.reject(new Error("network down"));
  await ctrl.exportHtml();
  expect(deps.toastError.calls).toEqual([["friendly: network down"]]);
  expect(ctrl.exporting).toBe(false);
});

// ── cancelExport ─────────────────────────────────────────────────────────────

test("cancelExport() no-ops when there is no active export id", async () => {
  const { ctrl, deps } = makeHostController();
  await ctrl.cancelExport();
  expect(deps.cancelExportHost.calls.length).toBe(0);
});

test("cancelExport() marks canceling and asks the host to cancel the active export", async () => {
  const { ctrl, deps } = makeHostController();
  ctrl.start();
  ctrl.syncProgress({ exportId: "exp-9", state: "rendering" });
  await ctrl.cancelExport();
  expect(ctrl.state).toBe("canceling");
  expect(deps.cancelExportHost.calls).toEqual([["exp-9"]]);
});

test("cancelExport() swallows a host cancel failure", async () => {
  const { host } = makeHostController();
  host.cancelExportHost = () => Promise.reject(new Error("ipc down"));
  const ctrl2 = new ExportController(undefined, host);
  ctrl2.start();
  ctrl2.syncProgress({ exportId: "exp-9", state: "rendering" });
  await expect(ctrl2.cancelExport()).resolves.toBeUndefined();
});
