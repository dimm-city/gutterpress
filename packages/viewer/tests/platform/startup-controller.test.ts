import { expect, test } from "bun:test";
import {
  StartupController,
  type StartupControllerDeps,
  type StartupPrefs,
} from "../../src/lib/routes/startup-controller.svelte";

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
    isLeftPanelPrefsLoaded: Spy<[]> & { value: boolean };
    applyLeftPanelPrefs: Spy<[StartupPrefs["leftPanel"]]>;
    setLandingShowPref: Spy<[boolean]>;
    setLandingReady: Spy<[boolean]>;
    setLandingHold: Spy<[boolean]>;
    setLandingContinueDir: Spy<[string | null]>;
    splashStatus: Spy<[string, number]>;
    setBusy: Spy<[boolean, string]>;
    getViewerProjectState: Spy<[string]>;
    startFolderPreview: Spy<[string, string, unknown]> & { impl?: () => Promise<void> };
    hasOpenError: Spy<[]> & { value: boolean };
  };
}

function make(): Harness {
  const isDesktop = Object.assign(spy<[]>(), { value: true });
  const isWorkspaceEngaged = Object.assign(spy<[]>(), { value: false });
  const isSomethingOpen = Object.assign(spy<[]>(), { value: false });
  const revealWindow = spy<[]>();
  const getViewerPrefs = Object.assign(spy<[]>(), {
    impl: async (): Promise<StartupPrefs> => ({}),
  });
  const isLeftPanelPrefsLoaded = Object.assign(spy<[]>(), { value: false });
  const applyLeftPanelPrefs = spy<[StartupPrefs["leftPanel"]]>();
  const setLandingShowPref = spy<[boolean]>();
  const setLandingReady = spy<[boolean]>();
  const setLandingHold = spy<[boolean]>();
  const setLandingContinueDir = spy<[string | null]>();
  const splashStatus = spy<[string, number]>();
  const setBusy = spy<[boolean, string]>();
  const getViewerProjectState = spy<[string]>();
  const startFolderPreview = Object.assign(spy<[string, string, unknown]>(), {
    impl: async () => {},
  });
  const hasOpenError = Object.assign(spy<[]>(), { value: false });

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
    revealWindow: () => revealWindow(),
    getViewerPrefs: () => {
      getViewerPrefs();
      return getViewerPrefs.impl();
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
    splashStatus: (m, p) => splashStatus(m, p),
    setBusy: (b, l) => setBusy(b, l),
    getViewerProjectState: (dir) => {
      getViewerProjectState(dir);
      return Promise.resolve(null);
    },
    startFolderPreview: (dir, label, restoreState) => {
      startFolderPreview(dir, label, restoreState);
      return startFolderPreview.impl();
    },
    hasOpenError: () => {
      hasOpenError();
      return hasOpenError.value;
    },
  };

  return {
    ctrl: new StartupController(deps),
    deps: {
      isDesktop,
      isWorkspaceEngaged,
      isSomethingOpen,
      revealWindow,
      getViewerPrefs,
      isLeftPanelPrefsLoaded,
      applyLeftPanelPrefs,
      setLandingShowPref,
      setLandingReady,
      setLandingHold,
      setLandingContinueDir,
      splashStatus,
      setBusy,
      getViewerProjectState,
      startFolderPreview,
      hasOpenError,
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

test("race: something opened while prefs loaded -> reveals once and returns without reading lastProjectDir", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: true });
  deps.isSomethingOpen.value = true;
  await ctrl.run();
  expect(deps.revealWindow.calls.length).toBe(1);
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

// ── No last project ─────────────────────────────────────────────────────────

test("no last project dir -> landing shown (default pref), reveals once, no reopen attempted", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: null });
  await ctrl.run();
  expect(deps.setLandingShowPref.calls).toEqual([[true]]);
  expect(deps.setLandingReady.calls).toEqual([[true]]);
  expect(deps.setLandingHold.calls.length).toBe(0); // no dir -> hold not needed
  expect(deps.revealWindow.calls.length).toBe(1);
  expect(deps.setLandingContinueDir.calls.length).toBe(0);
  expect(deps.startFolderPreview.calls.length).toBe(0);
});

// ── Landing enabled + last project: hold + reveal BEFORE the reopen awaits ────

test("landing enabled with a last project: holds the landing, reveals immediately (before startFolderPreview resolves), then reopens behind it", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: true });
  // Reveal must have already happened by the time startFolderPreview is
  // invoked — it must NOT be deferred until after the reopen resolves (that
  // would leave the landing sitting uninteractive behind the splash for the
  // whole reopen).
  let revealedBeforeReopenStarted = false;
  deps.startFolderPreview.impl = async () => {
    revealedBeforeReopenStarted = deps.revealWindow.calls.length === 1;
  };
  await ctrl.run();
  expect(revealedBeforeReopenStarted).toBe(true);
  expect(deps.setLandingHold.calls).toEqual([[true]]);
  expect(deps.revealWindow.calls.length).toBe(1);
  expect(deps.setBusy.calls).toEqual([[true, "Reopening previous folder…"]]);
  expect(deps.setLandingContinueDir.calls).toEqual([["/proj"]]);
  expect(deps.startFolderPreview.calls.length).toBe(1);
  expect(deps.startFolderPreview.calls[0]![0]).toBe("/proj");
  expect(deps.startFolderPreview.calls[0]![1]).toBe("Reopening previous folder…");
  // Landing enabled: no splashStatus call (that's the landing-off path only).
  expect(deps.splashStatus.calls.length).toBe(0);
});

test("landing enabled + reopen fails (openError): does NOT reveal again (already revealed before the reopen)", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: true });
  deps.hasOpenError.value = true;
  await ctrl.run();
  // reveal() happened once, at the "showLanding" branch — the openError
  // branch only fires reveal on the landing-OFF path (see next test), so a
  // second reveal here would be the double-call the docblock says never
  // happens today.
  expect(deps.revealWindow.calls.length).toBe(1);
});

// ── Landing disabled (pre-landing behavior) ────────────────────────────────────

test("landing disabled with a last project: sends splash status, reopens, no reveal on success (render-complete owns it)", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: false });
  await ctrl.run();
  expect(deps.setLandingHold.calls.length).toBe(0);
  expect(deps.splashStatus.calls).toEqual([["Opening your project…", 45]]);
  expect(deps.startFolderPreview.calls.length).toBe(1);
  expect(deps.revealWindow.calls.length).toBe(0);
});

test("landing disabled + reopen fails (openError): reveals so the window isn't stuck behind the splash", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: false });
  deps.hasOpenError.value = true;
  await ctrl.run();
  expect(deps.revealWindow.calls.length).toBe(1);
});

test("landing disabled + reopen succeeds (no openError): no reveal from this controller", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = async () => ({ lastProjectDir: "/proj", showLandingAtStartup: false });
  deps.hasOpenError.value = false;
  await ctrl.run();
  expect(deps.revealWindow.calls.length).toBe(0);
});

// ── Prefs read failure ──────────────────────────────────────────────────────

test("prefs read failure: marks landing ready and reveals once", async () => {
  const { ctrl, deps } = make();
  deps.getViewerPrefs.impl = () => Promise.reject(new Error("boom"));
  await ctrl.run();
  expect(deps.setLandingReady.calls).toEqual([[true]]);
  expect(deps.revealWindow.calls.length).toBe(1);
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
