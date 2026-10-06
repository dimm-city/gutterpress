/**
 * Shared `HostServices` fake for route-level suites: ONE base object here,
 * per-suite overrides for the pieces a given test genuinely customizes, so a
 * contract change is one edit rather than a sweep of hand-copied fakes that
 * would compile silently behind `as unknown as HostServices` casts. Same
 * rationale as the sibling electron-mock.ts / route-test-helpers.ts.
 *
 * Each supplied override domain is spread OVER the base domain (so
 * `desktop: { getUserDataPath: () => dir }` keeps the other desktop fakes).
 *
 * The lib itself is not part of this object: routes reach it through
 * `loadLib()` in `src/routes/api/_lib/route.ts`, which suites substitute with
 * `setLibForTests()`.
 */
import type { HostServices } from "../../electron/server-bridge/host-services";
import type { TokenStore } from "../../electron/server-bridge/remote-hooks";
import type { UpdaterStatus } from "../../src/lib/platform/shared-types";
import type { AppImageStatus } from "../../electron/appimage-integration";

/** Per-domain overrides, merged over the base domain. */
export type HostServicesOverrides = {
  [K in keyof HostServices]?: Partial<HostServices[K]>;
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
  staleCopy: null,
  paths: {
    appImage: "/fake/home/.local/bin/gutterpress.AppImage",
    desktopEntry: "/fake/home/.local/share/applications/city.dimm.gutterpress.desktop",
    icon: "/fake/home/.local/share/icons/hicolor/512x512/apps/city.dimm.gutterpress.png",
  },
});
const idleUpdaterStatus = (): UpdaterStatus => ({
  currentVersion: "0.0.0-test",
  stagedVersion: null,
  availableVersion: null,
  availableAction: null,
  phase: "idle",
  error: null,
});

export function makeHostServices(overrides: HostServicesOverrides = {}): HostServices {
  const base: HostServices = {
    app: { setRendererDirty: noop },
    appImage: {
      getStatus: async () => unsupportedAppImageStatus(),
      install: unstubbed("appImage.install"),
      remove: unstubbed("appImage.remove"),
    },
    desktop: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
      showSaveDialog: async () => ({ canceled: true }),
      confirmNpmPluginInstall: async () => false,
      confirmUnsavedChanges: async () => "cancel" as const,
      openExternal: async () => {},
      showItemInFolder: noop,
      openLogsFolder: async () => {},
      getNativeTheme: () => ({ shouldUseDarkColors: false }),
      getUserDataPath: () => "/fake/userData",
    },
    doctor: { getDesktopVersion: () => "0.0.0-test" },
    fsGuard: { projectRoots: () => [] as string[], readOnlyRoots: () => [] as string[] },
    media: { createThumbnail: async () => null },
    pickedFiles: { register: noop, consume: () => false },
    prefs: {
      readPrefs: async () => ({}),
      updatePrefs: async (mutate) => mutate({}),
      readSettings: async () => ({}) as never,
      updateSettings: async () => ({}) as never,
      existingDirectory: async () => null,
      readProjectState: () => null,
      writeProjectState: (states) => states,
      defaultProjectSearchRoots: () => [],
      scanForProjects: async () => [],
      toggleFavoriteFolder: (favorites) => ({ favorites: favorites ?? [], favorited: false }),
      removeRecentFolder: () => [],
    },
    recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] },
    remote: {
      tokenStore: {} as TokenStore,
      GITHUB_HOST: "github.com",
      cloneRepository: unstubbed("remote.cloneRepository"),
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
    vcs: { operationLogPath: () => "/fake/log", repairBackupDir: () => "/fake/repair" },
    write: {
      scheduleAutoSnapshot: noop,
      scheduleAutoSync: noop,
      notifyPreviewSettledWrite: noop,
      getWatchedDir: () => null,
      getRepositoryRoot: () => null,
    },
  };

  const services: Record<string, unknown> = { ...base };
  for (const [domain, value] of Object.entries(overrides)) {
    services[domain] = { ...(services[domain] as object), ...(value as object) };
  }
  return services as unknown as HostServices;
}
