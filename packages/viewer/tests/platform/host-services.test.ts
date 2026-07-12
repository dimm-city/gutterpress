import { test, expect } from "bun:test";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { getAppHooks } from "../../electron/server-bridge/app-hooks";
import { getConflictPreviewHooks } from "../../electron/server-bridge/conflict-preview-hooks";
import { getDesktopHooks, getDoctorHooks } from "../../electron/server-bridge/host-hooks";
import { getFsGuardHooks } from "../../electron/server-bridge/fs-guard";
import { getMediaHooks } from "../../electron/server-bridge/media-hooks";
import { getPickedFilesHooks } from "../../electron/server-bridge/picked-files";
import { getPrefsHooks } from "../../electron/server-bridge/prefs-hooks";
import { getRecoveryHooks } from "../../electron/server-bridge/recovery-hooks";
import { getRemoteHooks } from "../../electron/server-bridge/remote-hooks";
import { getVcsHooks } from "../../electron/server-bridge/vcs-hooks";
import { getWatchHooks } from "../../electron/server-bridge/watch-hooks";
import { getWriteHooks } from "../../electron/server-bridge/write-hooks";

// ARCH review #31: 11 independent globalThis service locators (one
// `createHostBridge` call per server-bridge/*-hooks.ts module, each with its
// own `__printMd*Hooks__` key) collapse into ONE `__printMdHost__` object.
// These tests lock:
//   1. getHostServices() returns null before any registration, and every
//      domain accessor (getAppHooks/getPrefsHooks/etc.) agrees — nothing is
//      independently registerable any more, so there is no "half
//      registered" state.
//   2. ONE registerHostServices() call populates every domain accessor
//      atomically, each reading the exact same object reference back off
//      the single stored HostServices.
//   3. getPrefsHooks/getRemoteHooks/getVcsHooks keep their generic
//      call-site narrowing (unaffected by the storage collapse).
//
// IMPORTANT: `__printMdHost__` is a single fixed globalThis key (unlike
// host-bridge.test.ts, which parameterizes a fresh key per test), so ordering
// within this file matters: the "before registration" assertions run FIRST,
// before the one register call every later test relies on.

test("getHostServices() and every domain accessor return null before registration", () => {
  expect(getHostServices()).toBeNull();
  expect(getAppHooks()).toBeNull();
  expect(getConflictPreviewHooks()).toBeNull();
  expect(getDesktopHooks()).toBeNull();
  expect(getDoctorHooks()).toBeNull();
  expect(getFsGuardHooks()).toBeNull();
  expect(getMediaHooks()).toBeNull();
  expect(getPickedFilesHooks()).toBeNull();
  expect(getPrefsHooks()).toBeNull();
  expect(getRecoveryHooks()).toBeNull();
  expect(getRemoteHooks()).toBeNull();
  expect(getVcsHooks()).toBeNull();
  expect(getWatchHooks()).toBeNull();
  expect(getWriteHooks()).toBeNull();
});

// One fake per domain field, built once and registered in a single call —
// mirrors main.ts's real "one registerHostServices() call, once every
// dependency exists" shape.
const fakeApp = { updateSplash: () => {}, showMainWindowAndCloseSplash: () => {}, setRendererDirty: () => {}, resolveFlush: () => {}, sendToRenderer: () => {} };
const fakeConflictPreview = { getConflictPreview: async () => ({ mine: "", theirs: "", kind: "both-edited" as const, isBinary: false }) };
const fakeDesktop = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true }),
  openExternal: async () => {},
  showItemInFolder: () => {},
  getNativeTheme: () => ({ shouldUseDarkColors: false }),
  getUserDataPath: () => "/fake/userData",
};
const fakeDoctor = { getViewerVersion: () => "0.0.0-test" };
const fakeFsGuard = { projectRoots: () => ["/fake/project"], readOnlyRoots: () => ["/fake/recovery"] };
const fakeMedia = { createThumbnail: async () => null };
const fakePickedFiles = { register: () => {}, consume: () => false };
const fakePrefs = {
  readPrefs: async () => ({}),
  writePrefs: async () => {},
  updatePrefs: async (mutate: (p: object) => object) => mutate({}),
  readSettings: async () => ({}),
  writeSettings: async () => {},
  existingDirectory: async () => null,
  readProjectState: () => null,
  writeProjectState: (states: unknown) => states,
  mergeSettings: (base: unknown) => base,
  defaultProjectSearchRoots: () => [],
  scanForProjects: async () => [],
  toggleFavoriteFolder: (favorites: unknown) => ({ favorites: (favorites as []) ?? [], favorited: false }),
  removeRecentFolder: () => [],
  loadLib: async () => ({}),
};
const fakeRecovery = { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] };
const fakeRemote = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };
const fakeVcs = { loadLib: async () => ({}), operationLogPath: () => "/fake/log" };
const fakeWatch = { startFolderWatch: () => {}, stopFolderWatch: () => {}, getWatchedDir: () => null };
const fakeWrite = { scheduleAutoSnapshot: () => {}, scheduleAutoSync: () => {}, getWatchedDir: () => null };

const fakeServices = {
  app: fakeApp,
  conflictPreview: fakeConflictPreview,
  desktop: fakeDesktop,
  doctor: fakeDoctor,
  fsGuard: fakeFsGuard,
  media: fakeMedia,
  pickedFiles: fakePickedFiles,
  prefs: fakePrefs,
  recovery: fakeRecovery,
  remote: fakeRemote,
  vcs: fakeVcs,
  watch: fakeWatch,
  write: fakeWrite,
} as unknown as HostServices;

test("registerHostServices() populates getHostServices() with the exact object reference", () => {
  registerHostServices(fakeServices);
  expect(getHostServices()).toBe(fakeServices);
});

test("every domain accessor reads its own field off the single registered object", () => {
  expect(getAppHooks()).toBe(fakeApp as never);
  expect(getConflictPreviewHooks()).toBe(fakeConflictPreview as never);
  expect(getDesktopHooks()).toBe(fakeDesktop as never);
  expect(getDoctorHooks()).toBe(fakeDoctor as never);
  expect(getFsGuardHooks()).toBe(fakeFsGuard as never);
  expect(getMediaHooks()).toBe(fakeMedia as never);
  expect(getPickedFilesHooks()).toBe(fakePickedFiles as never);
  expect(getPrefsHooks()).toBe(fakePrefs as never);
  expect(getRecoveryHooks()).toBe(fakeRecovery as never);
  expect(getRemoteHooks()).toBe(fakeRemote as never);
  expect(getVcsHooks()).toBe(fakeVcs as never);
  expect(getWatchHooks()).toBe(fakeWatch as never);
  expect(getWriteHooks()).toBe(fakeWrite as never);
});

test("getPrefsHooks/getRemoteHooks/getVcsHooks keep their generic call-site narrowing after the collapse", () => {
  // These don't change behavior at runtime (same object back either way) —
  // this just locks that the generic signatures still compile/callable the
  // way ~40 route files already use them.
  interface NarrowLib { ping(): string }
  const prefs = getPrefsHooks<NarrowLib>();
  const remote = getRemoteHooks<NarrowLib, { token: string }>();
  const vcs = getVcsHooks<NarrowLib>();
  expect(prefs).toBe(fakePrefs as never);
  expect(remote).toBe(fakeRemote as never);
  expect(vcs).toBe(fakeVcs as never);
});
