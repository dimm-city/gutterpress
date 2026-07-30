import { expect, test } from "bun:test";
import {
  ProjectLifecycleController,
  type ProjectLifecycleDeps,
  type ProjectLifecyclePreviewResult,
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
  /** The classification session the controller retargets through (repoRoot/activeBookDir). */
  projectSession: {
    repoRoot: string | null;
    books: { path: string; title: string }[];
    activeBookDir: string | null;
  };
  deps: {
    isDesktop: Spy<[]> & { value: boolean };
    startPreviewHost: Spy<[{ key: string; displayName: string }]>;
    stopPreviewHost: Spy<[]>;
    adoptFolder: Spy<[string]>;
    invalidateDiscoveredProjects: Spy<[]>;
    classify: Spy<[string]>;
    clearSyncDiag: Spy<[]>;
    setViewModeSetting: Spy<[string]>;
    setSplitRatioSetting: Spy<[number]>;
    setPendingRestore: Spy<[unknown, unknown]>;
    getDesktopProjectState: Spy<[string]>;
    resetFirstRenderGate: Spy<[]>;
    flushBuffer: Spy<[]>;
    resetBuffer: Spy<[]>;
    ensureEditorFile: Spy<[]>;
    startFolderWatch: Spy<[string]>;
    setPendingRecoveryScanDir: Spy<[string | null]>;
    scanForRecovery: Spy<[string]>;
    dismissLanding: Spy<[boolean | undefined]>;
    clearStaleProjectState: Spy<[]>;
    resetExtras: Spy<[]>;
    toastError: Spy<[string]>;
    toastInfo: Spy<[string]>;
    landingVisible: boolean;
    pageNav: { totalPages: number; currentPage: number };
    zoomView: { userSetViewMode: boolean; restoreSplitRatio: Spy<[number]> };
    startPreviewResult: ProjectLifecyclePreviewResult;
    startPreviewImpl?: (input: {
      key: string;
      displayName: string;
    }) => Promise<ProjectLifecyclePreviewResult>;
    classifyImpl?: (dir: string) => Promise<void>;
    flushResult: boolean;
    activeBookHasManifest: boolean;
    /** Per-project persisted state, keyed by the dir it is stored under. */
    projectStateByDir: Record<string, { currentPage?: number; viewMode?: "single" | "two-column" } | null>;
    flushImpl?: () => Promise<boolean>;
  };
}

function make(): Harness {
  const isDesktop = Object.assign(spy<[]>(), { value: true });
  const startPreviewHost = spy<[{ key: string; displayName: string }]>();
  const stopPreviewHost = spy<[]>();
  const adoptFolder = spy<[string]>();
  const invalidateDiscoveredProjects = spy<[]>();
  const classify = spy<[string]>();
  const clearSyncDiag = spy<[]>();
  const setViewModeSetting = spy<[string]>();
  const setSplitRatioSetting = spy<[number]>();
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
  const resetExtras = spy<[]>();
  const toastError = spy<[string]>();
  const toastInfo = spy<[string]>();
  const getDesktopProjectState = spy<[string]>();

  const state: Harness["deps"] = {
    isDesktop,
    startPreviewHost,
    stopPreviewHost,
    adoptFolder,
    invalidateDiscoveredProjects,
    classify,
    clearSyncDiag,
    setViewModeSetting,
    setSplitRatioSetting,
    setPendingRestore,
    getDesktopProjectState,
    resetFirstRenderGate,
    flushBuffer,
    resetBuffer,
    ensureEditorFile,
    startFolderWatch,
    setPendingRecoveryScanDir,
    scanForRecovery,
    dismissLanding,
    clearStaleProjectState,
    resetExtras,
    toastError,
    toastInfo,
    landingVisible: false,
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: spy<[number]>() },
    startPreviewResult: { previewStarted: true, url: "preview://book", title: "My Book" },
    flushResult: true,
    activeBookHasManifest: true,
    /** Per-project persisted state, keyed by the dir it is stored under. */
    projectStateByDir: {} as Record<string, { currentPage?: number; viewMode?: "single" | "two-column" } | null>,
  };

  const projectSession = {
    repoRoot: null as string | null,
    books: [] as { path: string; title: string }[],
    activeBookDir: null as string | null,
    get activeBookHasManifest() {
      return state.activeBookHasManifest;
    },
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
    invalidateDiscoveredProjects: () => invalidateDiscoveredProjects(),
    projectSession,
    clearSyncDiag: () => clearSyncDiag(),
    pageNav: state.pageNav,
    zoomView: state.zoomView as unknown as Harness["deps"]["zoomView"] & {
      restoreSplitRatio(ratio: number): void;
    },
    setViewModeSetting: (mode) => setViewModeSetting(mode),
    setSplitRatioSetting: (value) => setSplitRatioSetting(value),
    setPendingRestore: (viewMode, page) => setPendingRestore(viewMode, page),
    getDesktopProjectState: (dir: string) => {
      getDesktopProjectState(dir);
      return Promise.resolve(state.projectStateByDir[dir] ?? null);
    },
    resetFirstRenderGate: () => resetFirstRenderGate(),
    flushBuffer: () => {
      flushBuffer();
      return state.flushImpl ? state.flushImpl() : Promise.resolve(state.flushResult);
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
    resetExtras: () => resetExtras(),
  };

  const ctrl = new ProjectLifecycleController(deps);
  return { ctrl, deps: state, projectSession };
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
  expect(ctrl.previewError).toBeNull();
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

test("startFolderPreview retains the successful-open setup banner for a loose folder", async () => {
  const { ctrl, deps } = make();
  deps.activeBookHasManifest = false;

  await ctrl.startFolderPreview("/loose");

  expect(ctrl.currentDir).toBe("/loose");
  expect(ctrl.currentFolderHasManifest).toBe(false);
});

test("startFolderPreview: defers the crash-recovery scan while the landing is visible", async () => {
  const { ctrl, deps } = make();
  deps.landingVisible = true;
  await ctrl.startFolderPreview("/proj");
  await flush();

  expect(deps.setPendingRecoveryScanDir.calls).toEqual([["/proj"]]);
  expect(deps.scanForRecovery.calls.length).toBe(0);
});

test("preview generation failure keeps the folder, files, watcher, and Problems surface open", async () => {
  const { ctrl, deps } = make();
  deps.startPreviewResult = {
    previewStarted: false,
    title: "Broken Book",
    error: "Missing stylesheet: /proj/css/missing.css",
  };

  expect(await ctrl.startFolderPreview("/proj", "Opening…")).toBe(true);

  expect(ctrl.currentDir).toBe("/proj");
  expect(ctrl.docTitle).toBe("Broken Book");
  expect(ctrl.previewUrl).toBeNull();
  expect(ctrl.previewError).toContain("Missing stylesheet");
  expect(ctrl.openError).toBeNull();
  expect(ctrl.rendering).toBe(false);
  expect(deps.ensureEditorFile.calls).toHaveLength(1);
  expect(deps.startFolderWatch.calls).toEqual([["/proj"]]);
  expect(deps.clearStaleProjectState.calls).toHaveLength(1);
  expect(deps.resetExtras.calls).toHaveLength(0);
});

test("retryPreview repairs only the preview and preserves the open workspace", async () => {
  const { ctrl, deps } = make();
  deps.startPreviewResult = {
    previewStarted: false,
    title: "Broken Book",
    error: "bad manifest",
  };
  await ctrl.startFolderPreview("/proj");
  deps.startPreviewResult = {
    previewStarted: true,
    url: "preview://repaired",
    title: "Repaired Book",
  };

  expect(await ctrl.retryPreview()).toBe(true);
  expect(ctrl.currentDir).toBe("/proj");
  expect(ctrl.previewUrl).toBe("preview://repaired");
  expect(ctrl.previewError).toBeNull();
  expect(ctrl.docTitle).toBe("Repaired Book");
  expect(deps.classify.calls).toEqual([["/proj"]]);
  expect(deps.resetBuffer.calls).toHaveLength(1);
  expect(deps.startFolderWatch.calls).toHaveLength(1);
});

test("a failed retry updates the error without discarding files or restarting the watcher", async () => {
  const { ctrl, deps } = make();
  deps.startPreviewResult = {
    previewStarted: false,
    title: "Broken Book",
    error: "first failure",
  };
  await ctrl.startFolderPreview("/proj");
  deps.startPreviewResult = {
    previewStarted: false,
    title: "Broken Book",
    error: "still missing css",
  };

  expect(await ctrl.retryPreview()).toBe(false);
  expect(ctrl.currentDir).toBe("/proj");
  expect(ctrl.previewError).toBe("still missing css");
  expect(deps.resetExtras.calls).toHaveLength(0);
  expect(deps.resetBuffer.calls).toHaveLength(1);
  expect(deps.startFolderWatch.calls).toHaveLength(1);
});

test("a failed pre-navigation flush preserves the open project and never starts the replacement", async () => {
  const { ctrl, deps } = make();
  ctrl.currentDir = "/current";
  ctrl.previewUrl = "preview://current";
  ctrl.docTitle = "Current";
  deps.flushResult = false;

  const opened = await ctrl.startFolderPreview("/replacement");

  expect(opened).toBe(false);
  expect(ctrl.currentDir).toBe("/current");
  expect(ctrl.previewUrl).toBe("preview://current");
  expect(ctrl.docTitle).toBe("Current");
  expect(ctrl.busy).toBe(false);
  expect(deps.classify.calls).toHaveLength(0);
  expect(deps.startPreviewHost.calls).toHaveLength(0);
  expect(deps.resetBuffer.calls).toHaveLength(0);
  expect(deps.resetExtras.calls).toHaveLength(0);
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
  // The open intent and cancel teardown each verify the buffer before replacing
  // state; both are harmless no-ops when no editor exists.
  // preview + calls the SAME resetExtras() as every other teardown path.
  expect(deps.flushBuffer.calls.length).toBe(2);
  expect(deps.stopPreviewHost.calls.length).toBe(1);
  expect(deps.resetExtras.calls.length).toBe(1);
});

// ── Failed open (H5 / M2 divergence fix) ─────────────────────────────────────

test("failed open: the catch path resets the FULL workspace via resetExtras (H5 fix), not a narrower hand-list", async () => {
  const { ctrl, deps } = make();
  deps.startPreviewImpl = () => Promise.reject(new Error("preview failed"));

  await ctrl.startFolderPreview("/broken");
  await flush();

  expect(ctrl.currentDir).toBeNull();
  expect(ctrl.previewUrl).toBeNull();
  expect(ctrl.openError).toBe("preview failed");
  expect(ctrl.busy).toBe(false);
  // Before the fix, only previewUrl/currentDir/currentUrl/currentFolderDisplayName/
  // docTitle/rendering/openError/pendingRecoveryScanDir were
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
    // The intent-boundary flush runs first; a later host-open rejection must
    // reset only after that successful flush.
    startPreviewHost: () => Promise.reject(new Error("preview failed")),
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: () => Promise.resolve(),
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      activeBookHasManifest: true,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setSplitRatioSetting: () => {},
    setPendingRestore: () => {},
    getDesktopProjectState: () => Promise.resolve(null),
    resetFirstRenderGate: () => {},
    flushBuffer: () => {
      order.push("flush");
      return Promise.resolve(true);
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
    resetExtras: () => order.push("resetExtras"),
  });

  await ctrl.startFolderPreview("/broken");
  await flush();

  expect(order).toEqual(["flush", "resetExtras"]);
  expect(ctrl.openError).toBe("preview failed");
});

test("a supersession landing DURING the outgoing-buffer pre-flush (before startPreviewHost) must not clobber the winning open's state", async () => {
  // #7 fix: the outgoing project's buffer is now flushed BEFORE
  // startPreviewHost is called (startPreviewHost is what moves the host's fs
  // authorization root — see the fix's comment at the call site). The epoch
  // guard must survive that await: if a second open wins WHILE the first
  // open is still parked awaiting its pre-flush, the stale first open's
  // re-check (right after the flush) must bail — it must never reach
  // startPreviewHost, reset a buffer, or touch the winner's state.
  const flushGate = deferred<boolean>();
  const resetExtras = spy<[]>();
  const resetBuffer = spy<[]>();
  let startCall = 0;
  let flushCall = 0;
  const ctrl = new ProjectLifecycleController({
    isDesktop: () => true,
    desktopRequiredMessage: "needs desktop",
    startPreviewHost: () => {
      startCall++;
      return Promise.resolve({ previewStarted: true as const, url: "preview://ok", title: "Ok" });
    },
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: () => Promise.resolve(),
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      activeBookHasManifest: true,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setSplitRatioSetting: () => {},
    setPendingRestore: () => {},
    getDesktopProjectState: () => Promise.resolve(null),
    resetFirstRenderGate: () => {},
    // ONLY the first invocation (the first open's pre-flush) blocks on
    // flushGate, resolved explicitly below after the second (winning) open
    // has already completed. The second open's own pre-flush (call #2)
    // resolves immediately so it isn't entangled with the stale first
    // open's timing.
    flushBuffer: () => {
      flushCall++;
      return flushCall === 1 ? flushGate.promise : Promise.resolve(true);
    },
    resetBuffer: () => resetBuffer(),
    ensureEditorFile: () => {},
    startFolderWatch: () => {},
    isLandingVisible: () => false,
    setPendingRecoveryScanDir: () => {},
    scanForRecovery: () => {},
    dismissLanding: () => {},
    toast: () => null,
    clearStaleProjectState: () => {},
    resetExtras: () => resetExtras(),
  });

  const first = ctrl.startFolderPreview("/first");
  // Let the first open enter the intent-boundary flush, before classify or
  // startPreviewHost can mutate either project session.
  await flush();
  expect(startCall).toBe(0);

  const second = ctrl.startFolderPreview("/second");
  await second;
  await flush();
  expect(ctrl.currentDir).toBe("/second");

  // Now let the stale first open's flush resolve.
  flushGate.resolve(true);
  await first;
  await flush();

  // The stale first open's post-flush supersession check must bail: it must
  // never call resetBuffer or startPreviewHost for /first, and must not
  // stomp the winner's state, report a stale error, or run
  // resetWorkspace()/resetExtras() at all.
  expect(startCall).toBe(1); // only /second ever reached startPreviewHost
  expect(resetBuffer.calls.length).toBe(1); // only /second's reset
  expect(ctrl.currentDir).toBe("/second");
  expect(ctrl.openError).toBeNull();
  expect(resetExtras.calls.length).toBe(0);
});

test("a superseded open's failure must not clobber the winning open's state", async () => {
  const { ctrl, deps } = make();
  const firstStart = deferred<ProjectLifecyclePreviewResult>();
  let call = 0;
  deps.startPreviewImpl = () => {
    call++;
    return call === 1
      ? firstStart.promise
      : Promise.resolve({ previewStarted: true as const, url: "preview://ok", title: "Ok" });
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

// ── Project switch flush-before-root-move (finding #7) ──────────────────────

test("startFolderPreview: switching projects flushes the OUTGOING project's dirty buffer BEFORE startPreviewHost moves the authorization root", async () => {
  // electron/preview/controller.ts's runOpen sets `activePreview` to the NEW
  // project the instant `api:preview` (this controller's `startPreviewHost`)
  // is dispatched — and `projectRoots()` (electron/server-bridge/fs-guard.ts)
  // is sourced SOLELY from `activePreview`. If the outgoing project's dirty
  // buffer isn't flushed to disk until AFTER startPreviewHost fires, the
  // flush's write lands outside the (already-moved) authorization root and is
  // rejected 403 by requireWithinProjectRoot — silently discarding the edit
  // when resetBuffer() then wipes the buffer regardless. The flush must
  // complete before startPreviewHost is ever called.
  const order: string[] = [];
  const ctrl = new ProjectLifecycleController({
    isDesktop: () => true,
    desktopRequiredMessage: "needs desktop",
    startPreviewHost: () => {
      order.push("startPreviewHost");
      return Promise.resolve({ previewStarted: true as const, url: "preview://b", title: "B" });
    },
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: () => Promise.resolve(),
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      activeBookHasManifest: true,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setSplitRatioSetting: () => {},
    setPendingRestore: () => {},
    getDesktopProjectState: () => Promise.resolve(null),
    resetFirstRenderGate: () => {},
    flushBuffer: () => {
      order.push("flush-start");
      // Model a real async disk write (e.g. EditorBuffer.flush's doSave)
      // completing on a later microtask, not synchronously.
      return Promise.resolve().then(() => {
        order.push("flush-end");
        return true;
      });
    },
    resetBuffer: () => order.push("resetBuffer"),
    ensureEditorFile: () => {},
    startFolderWatch: () => {},
    isLandingVisible: () => false,
    setPendingRecoveryScanDir: () => {},
    scanForRecovery: () => {},
    dismissLanding: () => {},
    toast: () => null,
    clearStaleProjectState: () => {},
    resetExtras: () => {},
  });

  // Project A is already open with (implicitly) a dirty editor buffer.
  ctrl.currentDir = "/projA";

  await ctrl.startFolderPreview("/projB");

  // The outgoing buffer's flush must fully settle — and the buffer must be
  // reset — before startPreviewHost (which moves the host's authorization
  // root to /projB) is ever invoked.
  expect(order).toEqual(["flush-start", "flush-end", "resetBuffer", "startPreviewHost"]);
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
    startPreviewHost: () => Promise.resolve({ previewStarted: true, url: "x", title: null }),
    stopPreviewHost: () => Promise.resolve({}),
    adoptFolder: (dir) => {
      adoptFolder(dir);
      return Promise.reject(new Error("disk full"));
    },
    invalidateDiscoveredProjects: () => {},
    projectSession: {
      repoRoot: null,
      books: [],
      activeBookDir: null,
      activeBookHasManifest: true,
      reset: () => {},
      classify: () => Promise.resolve(),
    },
    clearSyncDiag: () => {},
    pageNav: { totalPages: 0, currentPage: 1 },
    zoomView: { userSetViewMode: false, restoreSplitRatio: () => {} },
    setViewModeSetting: () => {},
    setSplitRatioSetting: () => {},
    setPendingRestore: () => {},
    getDesktopProjectState: () => Promise.resolve(null),
    resetFirstRenderGate: () => {},
    flushBuffer: () => Promise.resolve(true),
    resetBuffer: () => {},
    ensureEditorFile: () => {},
    startFolderWatch: () => {},
    isLandingVisible: () => false,
    setPendingRecoveryScanDir: () => {},
    scanForRecovery: () => {},
    dismissLanding: () => {},
    toast: () => null,
    clearStaleProjectState: () => {},
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
  await ctrl.openUrl("https://example.com");
  await flush();

  expect(ctrl.sourceMode).toBe("url");
  expect(ctrl.currentUrl).toBe("https://example.com");
  expect(ctrl.busy).toBe(false);
  // Before the fix, openUrl hand-listed its own subset (missing
  // recoveryScanDir/recoveryItems/previewHidden/pageNav.pageEditing). It now
  // calls the identical resetExtras() every other teardown path calls.
  expect(deps.resetExtras.calls.length).toBe(1);
  expect(deps.flushBuffer.calls.length).toBe(2);

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

test("openUrl preserves the folder workspace when its buffer cannot flush", async () => {
  const { ctrl, deps } = make();
  ctrl.currentDir = "/proj";
  ctrl.previewUrl = "preview://proj";
  ctrl.docTitle = "Project";
  deps.flushResult = false;

  expect(await ctrl.openUrl("https://example.com")).toBe(false);
  expect(ctrl.currentDir).toBe("/proj");
  expect(ctrl.previewUrl).toBe("preview://proj");
  expect(ctrl.docTitle).toBe("Project");
  expect(ctrl.sourceMode).toBe("folder");
  expect(deps.resetExtras.calls).toHaveLength(0);
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

test("stopPreview leaves the project and host preview open when flush fails", async () => {
  const { ctrl, deps } = make();
  ctrl.currentDir = "/proj";
  ctrl.previewUrl = "preview://proj";
  deps.flushResult = false;

  expect(await ctrl.stopPreview()).toBe(false);
  expect(ctrl.currentDir).toBe("/proj");
  expect(ctrl.previewUrl).toBe("preview://proj");
  expect(deps.stopPreviewHost.calls).toHaveLength(0);
  expect(deps.resetExtras.calls).toHaveLength(0);
});

test("all three teardown paths (stopPreview, openUrl, failed-open catch) call the identical resetExtras hook", async () => {
  const { ctrl: a, deps: depsA } = make();
  await a.stopPreview();
  expect(depsA.resetExtras.calls.length).toBe(1);

  const { ctrl: b, deps: depsB } = make();
  await b.openUrl("https://example.com");
  expect(depsB.resetExtras.calls.length).toBe(1);

  const { ctrl: c, deps: depsC } = make();
  depsC.startPreviewImpl = () => Promise.reject(new Error("boom"));
  await c.startFolderPreview("/x");
  expect(depsC.resetExtras.calls.length).toBe(1);
});

// ── 2026-07-29 audit: the restore-state key must be the RESOLVED book ─────────
//
// The per-project page/view-mode/split state is WRITTEN under the resolved book
// dir (`lifecycle.currentDir`), but every caller used to READ it under the dir
// the user PICKED — and those differ exactly when the session retargets: an
// open keyed to the repo root, or to a folder inside a book. So the read missed
// and the book silently opened at page 1 with the default view mode.
//
// Switching books had a second form of the same bug: `switchBook` passed no
// restore state at all, so the target book ALWAYS opened at page 1 even when it
// had saved state — inconsistent with every other way of opening that book.

test("restore state is read for the RESOLVED book dir, not the picked dir", async () => {
  const h = make();
  h.projectSession.repoRoot = "/repo";
  h.projectSession.activeBookDir = "/repo/books/field-guide";
  h.deps.projectStateByDir["/repo/books/field-guide"] = { currentPage: 7, viewMode: "two-column" };
  h.deps.projectStateByDir["/repo"] = { currentPage: 1 };

  await h.ctrl.startFolderPreview("/repo");

  expect(h.deps.getDesktopProjectState.calls).toEqual([["/repo/books/field-guide"]]);
  expect(h.deps.setPendingRestore.calls).toEqual([["two-column", 7]]);
});

test("switching books restores the TARGET book's saved page and view mode", async () => {
  const h = make();
  h.projectSession.repoRoot = "/repo";
  h.projectSession.activeBookDir = "/repo/books/beta";
  h.deps.projectStateByDir["/repo/books/beta"] = { currentPage: 4, viewMode: "single" };

  // switchBook's shape: no restore state supplied by the caller.
  await h.ctrl.startFolderPreview("/repo/books/beta", "Switching book…");

  expect(h.deps.getDesktopProjectState.calls).toEqual([["/repo/books/beta"]]);
  expect(h.deps.setPendingRestore.calls).toEqual([["single", 4]]);
});

test("a book with no saved state opens at the defaults, with no restore applied", async () => {
  const h = make();
  h.projectSession.activeBookDir = null;

  await h.ctrl.startFolderPreview("/loose-folder");

  expect(h.deps.getDesktopProjectState.calls).toEqual([["/loose-folder"]]);
  expect(h.deps.setPendingRestore.calls).toEqual([[null, null]]);
});
