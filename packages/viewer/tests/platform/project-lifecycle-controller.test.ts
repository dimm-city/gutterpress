import { expect, test } from "bun:test";
import {
  ProjectLifecycleController,
  type ProjectLifecycleDeps,
} from "../../src/lib/routes/project-lifecycle-controller.svelte";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / project-session-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Flush the microtask/macrotask queue so `.then().finally()` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type Spy<A extends unknown[] = unknown[]> = ((...a: A) => void) & { calls: A[] };
const spy = <A extends unknown[] = unknown[]>(): Spy<A> => {
  const fn = ((...a: A) => {
    fn.calls.push(a);
  }) as Spy<A>;
  fn.calls = [];
  return fn;
};

/** A promise whose resolution/rejection the test controls explicitly. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  ctrl: ProjectLifecycleController;
  deps: {
    isDesktop: Spy<[]> & { value: boolean };
    startPreviewHost: Spy<[{ key: string; displayName: string }]>;
    stopPreviewHost: Spy<[]>;
    adoptFolder: Spy<[string]>;
    listDir: Spy<[string]>;
    invalidateDiscoveredProjects: Spy<[]>;
    classify: Spy<[string]>;
    clearSyncDiag: Spy<[]>;
    setViewModeSetting: Spy<[string]>;
    setPendingRestore: Spy<[unknown, unknown]>;
    resetFirstRenderGate: Spy<[]>;
    flushBuffer: Spy<[]>;
    resetBuffer: Spy<[]>;
    ensureEditorFile: Spy<[]>;
    startFolderWatch: Spy<[string]>;
    setPendingRecoveryScanDir: Spy<[string | null]>;
    scanForRecovery: Spy<[string]>;
    dismissLanding: Spy<[boolean | undefined]>;
    clearStaleProjectState: Spy<[]>;
    onMissingSharedAssets: Spy<[string[]]>;
    resetExtras: Spy<[]>;
    toastError: Spy<[string]>;
    toastInfo: Spy<[string]>;
    landingVisible: boolean;
    pageNav: { totalPages: number; currentPage: number };
    zoomView: { userSetViewMode: boolean; restoreSplitRatio: Spy<[number]> };
    startPreviewResult: { url: string; title: string | null; missingSharedAssets?: string[] };
    startPreviewImpl?: (input: {
      key: string;
      displayName: string;
    }) => Promise<{ url: string; title: string | null; missingSharedAssets?: string[] }>;
    classifyImpl?: (dir: string) => Promise<void>;
  };
}

function make(): Harness {
  const isDesktop = Object.assign(spy<[]>(), { value: true });
  const startPreviewHost = spy<[{ key: string; displayName: string }]>();
  const stopPreviewHost = spy<[]>();
  const adoptFolder = spy<[string]>();
  const listDir = spy<[string]>();
  const invalidateDiscoveredProjects = spy<[]>();
  const classify = spy<[string]>();
  const clearSyncDiag = spy<[]>();
  const setViewModeSetting = spy<[string]>();
  const setPendingRestore = spy<[unknown, unknown]>();
  const resetFirstRenderGate = spy<[]>();
  const flushBuffer = spy<[]>();
  const resetBuffer = spy<[]>();
  const ensureEditorFile = spy<[]>();
  const startFolderWatch = spy<[string]>();
  const setPendingRecoveryScanDir = spy<[string | null]>();
  const scanForRecovery = spy<[string]>();
  const dismissLanding = spy<[boolean | undefined]>();
  const clearStaleProjectState = spy<[]>();
  const onMissingSharedAssets = spy<[string[]]>();
  const resetExtras = spy<[]>();
  const toastError = spy<[string]>();
  const toastInfo = spy<[string]>();

  const state: Harness["deps"] = {
    isDesktop,
    startPreviewHost,
    stopPreviewHost,
    adoptFolder,
    listDir,
    invalidateDiscoveredProjects,
    classify,
    clearSyncDiag,
    setViewModeSetting,
    setPendingRestore,
    resetFirstRenderGate,
    flushBuffer,
    resetBuffer,
    ensureEditorFile,
    startFolderWatch,
    setPendingRecoveryScanDir,
    scanForRecovery,
    dismissLanding,
    clearStaleProjectState,
    onMissingSharedAssets,
    resetExtras,
    toastError,
    toastInfo,
    landingVisible: false,
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: spy<[number]>() },
    startPreviewResult: { url: "preview://book", title: "My Book" },
  };

  const projectSession = {
    repoRoot: null as string | null,
    books: [] as { path: string; title: string }[],
    activeBookDir: null as string | null,
    reset: () => {},
    classify: (dir: string) => {
      classify(dir);
      return state.classifyImpl ? state.classifyImpl(dir) : Promise.resolve();
    },
  };

  const deps: ProjectLifecycleDeps = {
    isDesktop: () => isDesktop.value,
    desktopRequiredMessage: "This needs the desktop app to continue.",
    startPreviewHost: (input) => {
      startPreviewHost(input);
      return state.startPreviewImpl
        ? state.startPreviewImpl(input)
        : Promise.resolve(state.startPreviewResult);
    },
    stopPreviewHost: () => {
      stopPreviewHost();
      return Promise.resolve({ stopped: true });
    },
    adoptFolder: (dir) => {
      adoptFolder(dir);
      return Promise.resolve();
    },
    listDir: (dir) => {
      listDir(dir);
      return Promise.resolve([]);
    },
    invalidateDiscoveredProjects: () => invalidateDiscoveredProjects(),
    projectSession,
    clearSyncDiag: () => clearSyncDiag(),
    pageNav: state.pageNav,
    zoomView: state.zoomView as unknown as Harness["deps"]["zoomView"] & {
      restoreSplitRatio(ratio: number): void;
    },
    setViewModeSetting: (mode) => setViewModeSetting(mode),
    setPendingRestore: (viewMode, page) => setPendingRestore(viewMode, page),
    resetFirstRenderGate: () => resetFirstRenderGate(),
    flushBuffer: () => {
      flushBuffer();
      return Promise.resolve();
    },
    resetBuffer: () => resetBuffer(),
    ensureEditorFile: () => ensureEditorFile(),
    startFolderWatch: (dir) => startFolderWatch(dir),
    isLandingVisible: () => state.landingVisible,
    setPendingRecoveryScanDir: (dir) => setPendingRecoveryScanDir(dir),
    scanForRecovery: (dir) => scanForRecovery(dir),
    dismissLanding: (run) => dismissLanding(run),
    toast: () => ({
      error: (msg: string) => toastError(msg),
      info: (msg: string) => toastInfo(msg),
    }),
    clearStaleProjectState: () => clearStaleProjectState(),
    onMissingSharedAssets: (paths) => onMissingSharedAssets(paths),
    resetExtras: () => resetExtras(),
  };

  const ctrl = new ProjectLifecycleController(deps);
  return { ctrl, deps: state };
}

// ── Initial state ────────────────────────────────────────────────────────────

test("initial public rune state matches the +page.svelte defaults", () => {
  const { ctrl } = make();
  expect(ctrl.previewUrl).toBeNull();
  expect(ctrl.currentDir).toBeNull();
  expect(ctrl.currentFolderDisplayName).toBeNull();
  expect(ctrl.currentUrl).toBeNull();
  expect(ctrl.sourceMode).toBe("folder");
  expect(ctrl.docTitle).toBeNull();
  expect(ctrl.busy).toBe(false);
  expect(ctrl.busyLabel).toBe("");
  expect(ctrl.rendering).toBe(false);
  expect(ctrl.renderProgressPage).toBe(0);
  expect(ctrl.renderCompleteOverlay).toBe(false);
  expect(ctrl.openError).toBeNull();
  expect(ctrl.failedOpenDir).toBeNull();
  expect(ctrl.urlPreviewError).toBeNull();
  expect(ctrl.saveWarning).toBeNull();
  expect(ctrl.currentFolderHasManifest).toBe(true);
  expect(ctrl.adoptBannerDismissed).toBe(false);
  expect(ctrl.adopting).toBe(false);
});

// ── Happy path ────────────────────────────────────────────────────────────────

test("startFolderPreview: happy path opens the folder and starts the watcher", async () => {
  const { ctrl, deps } = make();
  await ctrl.startFolderPreview("/proj", "Opening…");
  await flush();

  expect(deps.classify.calls).toEqual([["/proj"]]);
  expect(deps.startPreviewHost.calls[0]?.[0]).toEqual({ key: "/proj", displayName: "proj" });
  expect(ctrl.currentDir).toBe("/proj");
  expect(ctrl.previewUrl).toBe("preview://book");
  expect(ctrl.docTitle).toBe("My Book");
  expect(ctrl.sourceMode).toBe("folder");
  expect(ctrl.rendering).toBe(true);
  expect(ctrl.busy).toBe(false);
  expect(deps.startFolderWatch.calls).toEqual([["/proj"]]);
  expect(deps.scanForRecovery.calls).toEqual([["/proj"]]);
  expect(deps.setPendingRecoveryScanDir.calls.length).toBe(0);
  expect(deps.clearStaleProjectState.calls.length).toBe(1);
  expect(deps.resetFirstRenderGate.calls.length).toBe(1);
});

test("startFolderPreview: defers the crash-recovery scan while the landing is visible", async () => {
  const { ctrl, deps } = make();
  deps.landingVisible = true;
  await ctrl.startFolderPreview("/proj");
  await flush();

  expect(deps.setPendingRecoveryScanDir.calls).toEqual([["/proj"]]);
  expect(deps.scanForRecovery.calls.length).toBe(0);
});

// ── Rapid double-open (epoch supersede) ──────────────────────────────────────

test("rapid double-open: the second open supersedes the first, whose late resolution is a no-op", async () => {
  const { ctrl, deps } = make();
  const firstClassify = deferred<void>();
  const secondClassify = deferred<void>();
  let call = 0;
  deps.classifyImpl = () => (++call === 1 ? firstClassify.promise : secondClassify.promise);

  const first = ctrl.startFolderPreview("/first");
  const second = ctrl.startFolderPreview("/second");

  // Resolve the SECOND (newer) open first, then the stale first one.
  secondClassify.resolve();
  await flush();
  await flush();
  firstClassify.resolve();
  await Promise.all([first, second]);
  await flush();

  // The winner is the second, later call — its state must be what's visible,
  // regardless of resolution order.
  expect(ctrl.currentDir).toBe("/second");
  expect(deps.startFolderWatch.calls).toEqual([["/second"]]);
  // The superseded first open must never have touched currentDir/previewUrl.
  expect(deps.startFolderWatch.calls.some((c) => c[0] === "/first")).toBe(false);
});

test("open-then-cancel: cancelOpen supersedes the in-flight open and tears the workspace back down", async () => {
  const { ctrl, deps } = make();
  const classifyGate = deferred<void>();
  deps.classifyImpl = () => classifyGate.promise;

  const openPromise = ctrl.startFolderPreview("/proj");
  expect(ctrl.busy).toBe(true);

  ctrl.cancelOpen();
  // cancelOpen clears busy synchronously and starts tearing down.
  expect(ctrl.busy).toBe(false);
  expect(ctrl.busyLabel).toBe("");

  // The in-flight open now resolves late — its continuation must bail.
  classifyGate.resolve();
  await openPromise;
  await flush();

  expect(ctrl.currentDir).toBeNull();
  expect(ctrl.previewUrl).toBeNull();
  expect(deps.startFolderWatch.calls.length).toBe(0);
  // cancelOpen routes through stopPreview, which flushes + stops the host
  // preview + calls the SAME resetExtras() as every other teardown path.
  expect(deps.flushBuffer.calls.length).toBe(1);
  expect(deps.stopPreviewHost.calls.length).toBe(1);
  expect(deps.resetExtras.calls.length).toBe(1);
});

// ── Failed open (H5 / M2 divergence fix) ─────────────────────────────────────

test("failed open: the catch path resets the FULL workspace via resetExtras (H5 fix), not a narrower hand-list", async () => {
  const { ctrl, deps } = make();
  deps.startPreviewImpl = () => Promise.reject(new Error("no manifest found"));

  await ctrl.startFolderPreview("/broken");
  await flush();

  expect(ctrl.currentDir).toBeNull();
  expect(ctrl.previewUrl).toBeNull();
  expect(ctrl.openError).toBe("no manifest found");
  expect(ctrl.failedOpenDir).toBe("/broken");
  expect(ctrl.busy).toBe(false);
  // Before the fix, only previewUrl/currentDir/currentUrl/currentFolderDisplayName/
  // docTitle/rendering/openError/failedOpenDir/pendingRecoveryScanDir were
  // cleared on this path — Problems/pageNav/the editor pane/the buffer/the
  // folder watcher were left stale. The unified resetWorkspace() now always
  // calls resetExtras(), closing that gap.
  expect(deps.resetExtras.calls.length).toBe(1);
});

test("failed open: flushes the buffer BEFORE resetWorkspace, mirroring stopPreview's flush-before-teardown (#44)", async () => {
  // A dedicated controller (rather than `make()`'s harness) so flushBuffer and
  // resetExtras can record into a SHARED order array — this is the exact
  // regression the fix-round finding flagged: before the fix, the catch
  // called resetWorkspace() -> resetExtras() -> buffer.reset() WITHOUT
  // flushing first, silently discarding a previously-open project's still-
  // pending (<500ms) debounced save with no disk write and no recovery
  // snapshot. stopPreview already flushes before resetWorkspace(); the catch
  // must do the same.
  const order: string[] = [];
  const ctrl = new ProjectLifecycleController({
    isDesktop: () => true,
    desktopRequiredMessage: "needs desktop",
    // Reject BEFORE the mid-pipeline flush inside the try (the try's own
    // flush only runs once startPreviewHost has resolved) — isolates the
    // catch's own flush call.
    startPreviewHost: () => Promise.reject(new Error("no manifest found")),
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: () => Promise.resolve(),
    listDir: () => Promise.resolve([]),
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setPendingRestore: () => {},
    resetFirstRenderGate: () => {},
    flushBuffer: () => {
      order.push("flush");
      return Promise.resolve();
    },
    resetBuffer: () => {},
    ensureEditorFile: () => {},
    startFolderWatch: () => {},
    isLandingVisible: () => false,
    setPendingRecoveryScanDir: () => {},
    scanForRecovery: () => {},
    dismissLanding: () => {},
    toast: () => null,
    clearStaleProjectState: () => {},
    onMissingSharedAssets: () => {},
    resetExtras: () => order.push("resetExtras"),
  });

  await ctrl.startFolderPreview("/broken");
  await flush();

  expect(order).toEqual(["flush", "resetExtras"]);
  expect(ctrl.openError).toBe("no manifest found");
  expect(ctrl.failedOpenDir).toBe("/broken");
});

test("a supersession landing DURING the failed-open catch's flush must not clobber the winning open's state", async () => {
  // The epoch guard must survive the newly-added await: if a second open wins
  // WHILE the first (failing) open's catch is still awaiting flushBuffer, the
  // stale catch's re-check must bail instead of resetting the winner's state
  // or reporting a stale error.
  const flushGate = deferred<void>();
  const resetExtras = spy<[]>();
  let startCall = 0;
  let flushCall = 0;
  const ctrl = new ProjectLifecycleController({
    isDesktop: () => true,
    desktopRequiredMessage: "needs desktop",
    startPreviewHost: () => {
      startCall++;
      return startCall === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ url: "preview://ok", title: "Ok" });
    },
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: () => Promise.resolve(),
    listDir: () => Promise.resolve([]),
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setPendingRestore: () => {},
    resetFirstRenderGate: () => {},
    // ONLY the first invocation (the first open's catch) blocks on flushGate,
    // resolved explicitly below after the second (winning) open has already
    // completed. The second open's own mid-pipeline flush (a normal, unrelated
    // buffer flush) resolves immediately so it isn't entangled with the
    // stale catch's timing.
    flushBuffer: () => {
      flushCall++;
      return flushCall === 1 ? flushGate.promise : Promise.resolve();
    },
    resetBuffer: () => {},
    ensureEditorFile: () => {},
    startFolderWatch: () => {},
    isLandingVisible: () => false,
    setPendingRecoveryScanDir: () => {},
    scanForRecovery: () => {},
    dismissLanding: () => {},
    toast: () => null,
    clearStaleProjectState: () => {},
    onMissingSharedAssets: () => {},
    resetExtras: () => resetExtras(),
  });

  const first = ctrl.startFolderPreview("/broken");
  // Let the first open run past classify/startPreviewHost's rejection and
  // into the catch, where it is now parked awaiting flushGate.
  await flush();

  const second = ctrl.startFolderPreview("/ok");
  await second;
  await flush();
  expect(ctrl.currentDir).toBe("/ok");

  // Now let the stale first open's flush resolve.
  flushGate.resolve();
  await first;
  await flush();

  expect(startCall).toBe(2);
  // The stale catch must not stomp the winner's state, report a stale error,
  // or run resetWorkspace()/resetExtras() at all.
  expect(ctrl.currentDir).toBe("/ok");
  expect(ctrl.openError).toBeNull();
  expect(ctrl.failedOpenDir).toBeNull();
  expect(resetExtras.calls.length).toBe(0);
});

test("a superseded open's failure must not clobber the winning open's state", async () => {
  const { ctrl, deps } = make();
  const firstStart = deferred<{ url: string; title: string | null }>();
  let call = 0;
  deps.startPreviewImpl = () => {
    call++;
    return call === 1 ? firstStart.promise : Promise.resolve({ url: "preview://ok", title: "Ok" });
  };

  // Start the first open alone and let it run past classify (default: resolves
  // immediately) so it actually reaches startPreviewHost and blocks there —
  // this is the in-flight state a genuinely overlapping second open would see.
  const first = ctrl.startFolderPreview("/broken");
  await flush();

  const second = ctrl.startFolderPreview("/ok");
  await second;
  await flush();
  expect(ctrl.currentDir).toBe("/ok");

  firstStart.reject(new Error("boom"));
  await first;
  await flush();

  // The stale failure must not stomp the winner's state.
  expect(ctrl.currentDir).toBe("/ok");
  expect(ctrl.openError).toBeNull();
});

// ── setUpAsBook ───────────────────────────────────────────────────────────────

test("setUpAsBook: success chains adoptFolder into startFolderPreview", async () => {
  const { ctrl, deps } = make();
  await ctrl.setUpAsBook("/loose");
  await flush();

  expect(deps.dismissLanding.calls).toEqual([[false]]);
  expect(deps.adoptFolder.calls).toEqual([["/loose"]]);
  expect(deps.invalidateDiscoveredProjects.calls.length).toBe(1);
  expect(deps.startPreviewHost.calls[0]?.[0]).toEqual({ key: "/loose", displayName: "loose" });
  expect(ctrl.currentDir).toBe("/loose");
  expect(ctrl.adopting).toBe(false);
});

test("setUpAsBook: adopt failure sets openError and clears busy without opening", async () => {
  // A dedicated controller (rather than `make()`'s harness) whose adoptFolder
  // rejects, so the failure path is exercised in isolation.
  const adoptFolder = spy<[string]>();
  const rejectingCtrl = new ProjectLifecycleController({
    isDesktop: () => true,
    desktopRequiredMessage: "needs desktop",
    startPreviewHost: () => Promise.resolve({ url: "x", title: null }),
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: (dir) => {
      adoptFolder(dir);
      return Promise.reject(new Error("disk full"));
    },
    listDir: () => Promise.resolve([]),
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setPendingRestore: () => {},
    resetFirstRenderGate: () => {},
    flushBuffer: () => Promise.resolve(),
    resetBuffer: () => {},
    ensureEditorFile: () => {},
    startFolderWatch: () => {},
    isLandingVisible: () => false,
    setPendingRecoveryScanDir: () => {},
    scanForRecovery: () => {},
    dismissLanding: () => {},
    toast: () => null,
    clearStaleProjectState: () => {},
    onMissingSharedAssets: () => {},
    resetExtras: () => {},
  });

  await rejectingCtrl.setUpAsBook("/loose");
  await flush();

  expect(adoptFolder.calls).toEqual([["/loose"]]);
  expect(rejectingCtrl.openError).toBe("disk full");
  expect(rejectingCtrl.busy).toBe(false);
  expect(rejectingCtrl.currentDir).toBeNull();
});

// ── openUrl (H5 / M2 divergence fix) ─────────────────────────────────────────

test("openUrl: supersedes an in-flight folder open and resets via the SAME resetExtras every teardown path uses", async () => {
  const { ctrl, deps } = make();
  const classifyGate = deferred<void>();
  deps.classifyImpl = () => classifyGate.promise;

  const openPromise = ctrl.startFolderPreview("/proj");
  ctrl.openUrl("https://example.com");
  await flush();

  expect(ctrl.sourceMode).toBe("url");
  expect(ctrl.currentUrl).toBe("https://example.com");
  expect(ctrl.busy).toBe(false);
  // Before the fix, openUrl hand-listed its own subset (missing
  // recoveryScanDir/recoveryItems/previewHidden/pageNav.pageEditing). It now
  // calls the identical resetExtras() every other teardown path calls.
  expect(deps.resetExtras.calls.length).toBe(1);

  // The superseded folder open resolves late — must not clobber the URL preview.
  classifyGate.resolve();
  await openPromise;
  await flush();
  expect(ctrl.sourceMode).toBe("url");
  expect(ctrl.currentDir).toBeNull();

  // The queued microtask settles the URL preview itself.
  expect(ctrl.previewUrl).toBe("https://example.com");
  expect(ctrl.rendering).toBe(false);
  expect(deps.pageNav.totalPages).toBe(0);
  expect(deps.pageNav.currentPage).toBe(1);
});

// ── stopPreview ───────────────────────────────────────────────────────────────

test("stopPreview: flushes the buffer, stops the host preview, and resets via resetExtras", async () => {
  const { ctrl, deps } = make();
  // Isolate stopPreview's own flush call: set currentDir directly rather than
  // via startFolderPreview, which itself flushes once when switching projects.
  ctrl.currentDir = "/proj";

  await ctrl.stopPreview();

  expect(deps.flushBuffer.calls.length).toBe(1);
  expect(deps.stopPreviewHost.calls.length).toBe(1);
  expect(deps.resetExtras.calls.length).toBe(1);
  expect(ctrl.currentDir).toBeNull();
  expect(ctrl.previewUrl).toBeNull();
  expect(ctrl.docTitle).toBeNull();
  expect(ctrl.rendering).toBe(false);
});

test("all three teardown paths (stopPreview, openUrl, failed-open catch) call the identical resetExtras hook", async () => {
  const { ctrl: a, deps: depsA } = make();
  await a.stopPreview();
  expect(depsA.resetExtras.calls.length).toBe(1);

  const { ctrl: b, deps: depsB } = make();
  b.openUrl("https://example.com");
  expect(depsB.resetExtras.calls.length).toBe(1);

  const { ctrl: c, deps: depsC } = make();
  depsC.startPreviewImpl = () => Promise.reject(new Error("boom"));
  await c.startFolderPreview("/x");
  expect(depsC.resetExtras.calls.length).toBe(1);
});
