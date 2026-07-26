/**
 * Shared `HostServices` fake for route-level suites (review finding: the
 * ~40-line all-domains fake was hand-copied into 10 platform suites, each
 * ending in its own `as unknown as HostServices` — so a contract change
 * meant a 10-file sweep, and a copy the sweep missed compiled silently
 * behind the cast. Same rationale as the sibling electron-mock.ts /
 * route-test-helpers.ts: ONE base object here, per-suite overrides for the
 * pieces a given test genuinely customizes).
 *
 * Each supplied override domain is spread OVER the base domain (so
 * `desktop: { getUserDataPath: () => dir }` keeps the other desktop fakes),
 * and an explicitly-`undefined` domain UN-registers it — how the
 * migrated-ipc/remote-path suites exercise their 503 "hooks not registered"
 * envelopes.
 *
 * Typing: the base object is checked against the real per-domain hook
 * interfaces via `FakeHostServices` below, so drift in any non-generic part
 * of the contract fails typechecking of THIS file instead of compiling
 * silently in ten. The residual gap is the three lib-generic domains:
 * `HostServices` instantiates `PrefsHooks`/`RemoteHooks`/`VcsHooks` with the
 * real `@dimm-city/print-md` module type, which a fake
 * `loadLib: async () => ({})` can never satisfy — so those three are held at
 * their loose generic defaults and the ONE unavoidable widening cast lives
 * at the end of `makeHostServices`, nowhere else.
 */
import type { HostServices } from "../../electron/server-bridge/host-services";
import type { PrefsHooks } from "../../electron/server-bridge/prefs-hooks";
import type { RemoteHooks, TokenStore } from "../../electron/server-bridge/remote-hooks";
import type { VcsHooks } from "../../electron/server-bridge/vcs-hooks";
import type { UpdaterStatus } from "../../src/lib/platform/shared-types";
import type { AppImageStatus } from "../../electron/appimage-integration";

/** `HostServices` with the lib-generic domains at their loose defaults — see the module doc. */
type FakeHostServices = Omit<HostServices, "prefs" | "remote" | "vcs"> & {
  prefs: PrefsHooks;
  remote: RemoteHooks;
  vcs: VcsHooks;
};

/** Per-domain overrides, merged over the base domain; `undefined` un-registers the domain. */
export type HostServicesOverrides = {
  [K in keyof FakeHostServices]?: Partial<FakeHostServices[K]> | undefined;
};

const noop = () => {};
const unstubbed = (name: string) => async (): Promise<never> => {
  throw new Error(`makeHostServices: ${name} not stubbed — pass an override`);
};
/** The off-Linux default: the AppImage menu action is simply unavailable (#119). */
const unsupportedAppImageStatus = (): AppImageStatus => ({
  supported: false,
  reason: "not-linux",
  installed: false,
  needsRepair: false,
  runningManagedCopy: false,
  paths: {
    appImage: "/fake/home/.local/bin/print-md-viewer.AppImage",
    desktopEntry: "/fake/home/.local/share/applications/city.dimm.print-md-viewer.desktop",
    icon: "/fake/home/.local/share/icons/hicolor/512x512/apps/city.dimm.print-md-viewer.png",
  },
});
const idleUpdaterStatus = (): UpdaterStatus => ({
  currentVersion: "0.0.0-test",
  stagedVersion: null,
  availableVersion: null,
  phase: "idle",
  error: null,
});

export function makeHostServices(overrides: HostServicesOverrides = {}): HostServices {
  const base = {
    app: { setRendererDirty: noop, sendToRenderer: noop },
    appImage: {
      getStatus: async () => unsupportedAppImageStatus(),
      install: unstubbed("appImage.install"),
      remove: unstubbed("appImage.remove"),
    },
    conflictPreview: {
      getConflictPreview: async () => ({ mine: "", theirs: "", kind: "both-edited" as const, isBinary: false }),
    },
    desktop: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
      showSaveDialog: async () => ({ canceled: true }),
      openExternal: async () => {},
      showItemInFolder: noop,
      getNativeTheme: () => ({ shouldUseDarkColors: false }),
      getUserDataPath: () => "/fake/userData",
    },
    doctor: { getViewerVersion: () => "0.0.0-test" },
    fsGuard: { projectRoots: () => [] as string[], readOnlyRoots: () => [] as string[] },
    media: { createThumbnail: async () => null },
    pickedFiles: { register: noop, consume: () => false },
    prefs: {
      readPrefs: async () => ({}),
      writePrefs: async () => {},
      updatePrefs: async (mutate) => mutate({}),
      readSettings: async () => ({}),
      updateSettings: async () => ({}),
      existingDirectory: async () => null,
      readProjectState: () => null,
      writeProjectState: (states) => states,
      defaultProjectSearchRoots: () => [],
      scanForProjects: async () => [],
      toggleFavoriteFolder: (favorites) => ({ favorites: favorites ?? [], favorited: false }),
      removeRecentFolder: () => [],
      loadLib: async () => ({}),
    },
    recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] },
    remote: {
      loadLib: async () => ({}),
      tokenStore: {} as TokenStore,
      GITHUB_HOST: "github.com",
      cloneRepository: unstubbed("remote.cloneRepository"),
      resolveSyncConflicts: unstubbed("remote.resolveSyncConflicts"),
    },
    savePaths: { register: noop, consume: () => false },
    sync: {
      setAutoSync: async (enabled) => ({ ok: true as const, autoSync: enabled }),
      getStatus: async () => null,
    },
    updater: {
      getStatus: idleUpdaterStatus,
      check: async () => idleUpdaterStatus(),
      download: async () => idleUpdaterStatus(),
    },
    vcs: { loadLib: async () => ({}), operationLogPath: () => "/fake/log" },
    watch: { startFolderWatch: noop, stopFolderWatch: noop, getWatchedDir: () => null },
    write: { scheduleAutoSnapshot: noop, scheduleAutoSync: noop, getWatchedDir: () => null },
  } satisfies FakeHostServices;

  const services: Record<string, unknown> = { ...base };
  for (const [domain, value] of Object.entries(overrides)) {
    const baseDomain = services[domain];
    services[domain] =
      value !== undefined && baseDomain !== undefined ? { ...baseDomain, ...value } : value;
  }
  // The one place the loose-generic fake widens to the real HostServices —
  // every suite used to carry its own copy of this cast.
  return services as unknown as HostServices;
}
