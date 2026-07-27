import { expect, test } from "bun:test";
import {
  StartupController,
  type StartupControllerDeps,
  type StartupPrefs,
} from "../../src/lib/routes/startup-controller.svelte";
import type { LastFlushFailure } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// project-lifecycle-controller.test / recovery-ui-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

type Spy<A extends unknown[] = unknown[]> = ((...a: A) => void) & { calls: A[] };
const spy = <A extends unknown[] = unknown[]>(): Spy<A> => {
  const fn = ((...a: A) => {
    fn.calls.push(a);
  }) as Spy<A>;
  fn.calls = [];
  return fn;
};

interface Harness {
  ctrl: StartupController;
  deps: {
    isDesktop: Spy<[]> & { value: boolean };
    isWorkspaceEngaged: Spy<[]> & { value: boolean };
    isSomethingOpen: Spy<[]> & { value: boolean };
    revealWindow: Spy<[]>;
    getViewerPrefs: Spy<[]> & { impl: () => Promise<StartupPrefs> };
    showLastFlushFailure: Spy<[LastFlushFailure]> & { value: boolean };
    acknowledgeFlushFailure: Spy<[string]>;
    isLeftPanelPrefsLoaded: Spy<[]> & { value: boolean };
    applyLeftPanelPrefs: Spy<[StartupPrefs["leftPanel"]]>;
    setLandingShowPref: Spy<[boolean]>;
    setLandingReady: Spy<[boolean]>;
    setLandingHold: Spy<[boolean]>;
    setLandingContinueDir: Spy<[string | null]>;
    setBusy: Spy<[boolean, string]>;
    getViewerProjectState: Spy<[string]>;
    startFolderPreview: Spy<[string, string, unknown]> & { impl?: () => Promise<boolean> };
  };
}

function make(): Harness {
  const isDesktop = Object.assign(spy<[]>(), { value: true });
  const isWorkspaceEngaged = Object.assign(spy<[]>(), { value: false });
  const isSomethingOpen = Object.assign(spy<[]>(), { value: false });
  const getViewerPrefs = Object.assign(spy<[]>(), {
    impl: async (): Promise<StartupPrefs> => ({}),
  });
  const isLeftPanelPrefsLoaded = Object.assign(spy<[]>(), { value: false });
  const showLastFlushFailure = Object.assign(spy<[LastFlushFailure]>(), { value: true });
  const acknowledgeFlushFailure = spy<[string]>();
  const applyLeftPanelPrefs = spy<[StartupPrefs["leftPanel"]]>();
  const setLandingShowPref = spy<[boolean]>();
  const setLandingReady = spy<[boolean]>();
  const setLandingHold = spy<[boolean]>();
  const setLandingContinueDir = spy<[string | null]>();
  const setBusy = spy<[boolean, string]>();
  const getViewerProjectState = spy<[string]>();
  const startFolderPreview = Object.assign(spy<[string, string, unknown]>(), {
    impl: async () => true,
  });

  const deps: StartupControllerDeps = {
    isDesktop: () => {
      isDesktop();
      return isDesktop.value;
    },
    isWorkspaceEngaged: () => {
      isWorkspaceEngaged();
      return isWorkspaceEngaged.value;
    },
    isSomethingOpen: () => {
      isSomethingOpen();
      return isSomethingOpen.value;
    },
    getViewerPrefs: () => {
      getViewerPrefs();
      return getViewerPrefs.impl();
    },
    showLastFlushFailure: (marker) => {
      showLastFlushFailure(marker);
      return showLastFlushFailure.value;
    },
    acknowledgeFlushFailure: (failedAt) => {
      acknowledgeFlushFailure(failedAt);
      return Promise.resolve();
    },
    isLeftPanelPrefsLoaded: () => {
      isLeftPanelPrefsLoaded();
      return isLeftPanelPrefsLoaded.value;
    },
    applyLeftPanelPrefs: (p) => applyLeftPanelPrefs(p),
    setLandingShowPref: (v) => setLandingShowPref(v),
    setLandingReady: (v) => setLandingReady(v),
    setLandingHold: (v) => setLandingHold(v),
    setLandingContinueDir: (v) => setLandingContinueDir(v),
    setBusy: (b, l) => setBusy(b, l),
    getViewerProjectState: (dir) => {
      getViewerProjectState(dir);
      return Promise.resolve(null);
    },
    startFolderPreview: (dir, label, restoreState) => {
      startFolderPreview(dir, label, restoreState);
      return startFolderPreview.impl();
    },
  };

  return {
    ctrl: new StartupController(deps),
    deps: {
      isDesktop,
      isWorkspaceEngaged,
      isSomethingOpen,
      getViewerPrefs,
      showLastFlushFailure,
      acknowledgeFlushFailure,
      isLeftPanelPrefsLoaded,
      applyLeftPanelPrefs,
      setLandingShowPref,
      setLandingReady,
      setLandingHold,
      setLandingContinueDir,
      setBusy,
      getViewerProjectState,
      startFolderPreview,
    },
  };
}

// ── Entry guards ──────────────────────────────────────────────────────────────

test("run() no-ops on the web (not desktop)", async () => {
  const { ctrl, deps } = make();
  deps.isDesktop.value = false;
  await ctrl.run();
  expect(deps.getViewerPrefs.calls.length).toBe(0);
  expect(ctrl.lastProjectChecked).toBe(false);
});

test("run() no-ops once lastProjectChecked is already true", async () => {
  const { ctrl, deps } = make();
  ctrl.lastProjectChecked = true;
  await ctrl.run();
  expect(deps.getViewerPrefs.calls.length).toBe(0);
});

test("run() no-ops when the workspace is already engaged (preview/dir/url/busy/error)", async () => {
  const { ctrl, deps } = make();
  deps.isWorkspaceEngaged.value = true;
  await ctrl.run();
  expect(deps.getViewerPrefs.calls.length).toBe(0);
  expect(ctrl.lastProjectChecked).toBe(false);
});

test("run() sets lastProjectChecked and autoOpeningLastProject synchronously before the first await, so a synchronous re-entrant call no-ops", async () => {
  const { ctrl, deps } = make();
  // Never resolves during this test — proves the guard fields flip before
  // the prefs promise settles.
  deps.getViewerPrefs.impl = () => new Promise(() => {});
  const first = ctrl.run();
  expect(ctrl.lastProjectChecked).toBe(true);
  expect(ctrl.autoOpeningLastProject).toBe(true);
  await ctrl.run(); // second call — must no-op, not double-fetch prefs
  expect(deps.getViewerPrefs.calls.length).toBe(1);
  void first;
});

// ── Race branch: something opened while prefs were loading ────────────────────

test("race: something opened while prefs loaded -> returns without reading lastProjectDir", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: true });
  deps.isSomethingOpen.value = true;
  await ctrl.run();
  expect(deps.setLandingContinueDir.calls.length).toBe(0);
  expect(deps.startFolderPreview.calls.length).toBe(0);
  expect(ctrl.autoOpeningLastProject).toBe(false);
});

// ── Left panel prefs ────────────────────────────────────────────────────────

test("applies left-panel prefs once when not already loaded", async () => {
  const { ctrl, deps } = make();
  const leftPanel = { open: true, activeTab: "files", width: 300 };
  deps.getViewerPrefs.impl = async () => ({ leftPanel });
  deps.isLeftPanelPrefsLoaded.value = false;
  await ctrl.run();
  expect(deps.applyLeftPanelPrefs.calls).toEqual([[leftPanel]]);
});

test("does not re-apply left-panel prefs when already loaded", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ leftPanel: { open: true } });
  deps.isLeftPanelPrefsLoaded.value = true;
  await ctrl.run();
  expect(deps.applyLeftPanelPrefs.calls.length).toBe(0);
});

test("surfaces and acknowledges the previous session's flush marker", async () => {
  const { ctrl, deps } = make();
  const marker = {
    projectDir: "/books/field-guide",
    failedAt: "2026-07-26T14:30:00.000Z",
  };
  deps.getViewerPrefs.impl = async () => ({ lastFlushFailed: marker });

  await ctrl.run();
  await Promise.resolve();

  expect(deps.showLastFlushFailure.calls).toEqual([[marker]]);
  expect(deps.acknowledgeFlushFailure.calls).toEqual([[marker.failedAt]]);
});

test("keeps the marker when no launch notice surface is ready", async () => {
  const { ctrl, deps } = make();
  const marker = { failedAt: "2026-07-26T14:30:00.000Z" };
  deps.getViewerPrefs.impl = async () => ({ lastFlushFailed: marker });
  deps.showLastFlushFailure.value = false;

  await ctrl.run();

  expect(deps.showLastFlushFailure.calls).toEqual([[marker]]);
  expect(deps.acknowledgeFlushFailure.calls).toHaveLength(0);
});

// ── No last project ─────────────────────────────────────────────────────────

test("no last project dir -> landing shown (default pref), no reopen attempted", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: null });
  await ctrl.run();
  expect(deps.setLandingShowPref.calls).toEqual([[true]]);
  expect(deps.setLandingReady.calls).toEqual([[true]]);
  expect(deps.setLandingHold.calls.length).toBe(0); // no dir -> hold not needed
  expect(deps.setLandingContinueDir.calls.length).toBe(0);
  expect(deps.startFolderPreview.calls.length).toBe(0);
});

// ── Landing enabled + last project: hold over the pre-render ────────────────

test("landing enabled with a last project: holds the landing, then reopens behind it", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: true });
  await ctrl.run();
  expect(deps.setLandingHold.calls).toEqual([[true]]);
  expect(deps.setBusy.calls).toEqual([[true, "Reopening previous folder…"]]);
  expect(deps.setLandingContinueDir.calls).toEqual([["/proj"]]);
  expect(deps.startFolderPreview.calls.length).toBe(1);
  expect(deps.startFolderPreview.calls[0]![0]).toBe("/proj");
  expect(deps.startFolderPreview.calls[0]![1]).toBe("Reopening previous folder…");
});

// ── Landing disabled (straight into the last project) ───────────────────────

test("landing disabled with a last project: reopens without holding the landing", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: false });
  await ctrl.run();
  expect(deps.setLandingHold.calls.length).toBe(0);
  expect(deps.startFolderPreview.calls.length).toBe(1);
});

test("file-association startup initializes preferences without reopening the last project", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({
    lastProjectDir: "/previous",
    showLandingAtStartup: false,
    leftPanel: { open: true, activeTab: "files" },
  });

  await ctrl.run(false);

  expect(deps.applyLeftPanelPrefs.calls).toEqual([[
    { open: true, activeTab: "files" },
  ]]);
  expect(deps.setLandingReady.calls).toEqual([[true]]);
  expect(deps.startFolderPreview.calls).toEqual([]);
});

// ── Prefs read failure ──────────────────────────────────────────────────────

test("prefs read failure: marks landing ready so the start screen is the first surface", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = () => Promise.reject(new Error("boom"));
  await ctrl.run();
  expect(deps.setLandingReady.calls).toEqual([[true]]);
  expect(ctrl.autoOpeningLastProject).toBe(false);
});

// ── autoOpeningLastProject always clears ────────────────────────────────────

test("autoOpeningLastProject clears after every branch (race, no-dir, reopen, error)", async () => {
  const { ctrl: c1 } = make();
  await c1.run();
  expect(c1.autoOpeningLastProject).toBe(false);

  const h2 = make();
  h2.deps.getViewerPrefs.impl = async () => ({ lastProjectDir: null });
  await h2.ctrl.run();
  expect(h2.ctrl.autoOpeningLastProject).toBe(false);

  const h3 = make();
  h3.deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/p", showLandingAtStartup: true });
  await h3.ctrl.run();
  expect(h3.ctrl.autoOpeningLastProject).toBe(false);
});
