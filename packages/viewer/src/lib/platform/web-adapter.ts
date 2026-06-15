/**
 * WebAdapter — stub for the future PWA host (#41 acceptance: "ready for 0.6.0,
 * throws 'not implemented' for file watch").
 *
 * The viewer ships Electron-only in 0.4.0; this adapter is selected only when
 * the app runs in a plain browser (e.g. `vite dev` with no preload). To match
 * today's behaviour in that context — where `window.electron` is undefined and
 * the app's capability guards short-circuit — host-service methods return
 * REJECTED promises (so existing `.catch()` fire-and-forget calls stay silent)
 * and subscription methods return a no-op unsubscribe. The genuinely
 * host-divergent primitives throw, to be implemented via the File System Access
 * API in 0.6.0.
 */
import { DEFAULT_SETTINGS } from "./contract";
import type {
  Platform,
  ViewerPrefs,
  ProjectState,
  AppSettings,
  DeepPartial,
  PreviewStartArgs,
  PreviewStartResult,
  BuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  RecentFolderEntry,
  FavoriteEntry,
  UpdaterApi,
  UpdaterStatus,
  NativeThemeState,
  DiscoveredProject,
  ProjectClassification,
  PrintSafeWarning,
  ProblemEntry,
  MediaImageEntry,
  MediaImageDetails,
  FileStat,
  FileWriteResult,
  RecoveryEntry,
  FolderChangedEvent,
  CreateProjectOptions,
  CreateProjectResult,
  SnapshotEntry,
  SnapshotPage,
  ListSnapshotsOptions,
  RestoreVersionResult,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  ProjectRemoteDiagnosis,
  RemoteAccessResult,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  SyncStatus,
} from "./contract";

const NOT_IMPL = "Web platform support lands in 0.6.0 (#41).";

function notImplemented(method: string): never {
  throw new Error(`${method}: ${NOT_IMPL}`);
}

function rejectNotImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`${method}: ${NOT_IMPL}`));
}

const SETTINGS_KEY = "print-md.app-settings";

/** Recursively merge a settings patch over a base, returning a new object. */
function deepMergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = { ...base[key], ...(value as object) };
    }
  }
  return out as unknown as AppSettings;
}

const webUpdater: UpdaterApi = {
  getStatus: () =>
    rejectNotImplemented("updater.getStatus") as Promise<UpdaterStatus>,
  check: () => rejectNotImplemented("updater.check") as Promise<UpdaterStatus>,
  applyNow: () => rejectNotImplemented("updater.applyNow"),
  markReady: () => rejectNotImplemented("updater.markReady"),
  onEvent: () => () => {},
};

export class WebAdapter implements Platform {
  readonly platform = "web" as const;
  readonly apiVersion = 0;
  readonly updater = webUpdater;

  // ── PlatformAdapter primitives — implemented in 0.6.0 ─────────────────────
  openFolder(): Promise<string | null> {
    return notImplemented("openFolder");
  }

  readFile(_path: string): Promise<string> {
    return notImplemented("readFile");
  }

  writeFile(_path: string, _content: string): Promise<FileWriteResult> {
    return notImplemented("writeFile");
  }

  listDir(_path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
    return notImplemented("listDir");
  }

  statFile(_path: string): Promise<FileStat> {
    return notImplemented("statFile");
  }

  watchFolder(_path: string, _cb: () => void): () => void {
    return notImplemented("watchFolder");
  }

  getSecret(_key: string): Promise<string | null> {
    return notImplemented("getSecret");
  }

  setSecret(_key: string, _value: string): Promise<void> {
    return notImplemented("setSecret");
  }

  // ── HostServices — reject so existing `.catch()` guards stay silent ───────
  savePdf(_defaultName?: string): Promise<string | null> {
    return rejectNotImplemented("savePdf");
  }

  // Image pick / copy (#31) — desktop-only in 0.4.x; stubs reject silently.
  pickImageFile(): Promise<string | null> {
    return rejectNotImplemented("pickImageFile");
  }

  copyFile(_srcPath: string, _destDir: string): Promise<string> {
    return rejectNotImplemented("copyFile");
  }

  // Media panel (#47) — desktop-only until the PWA lands. The panel itself
  // guards with isDesktop(); thumbnails/inspection degrade to "unavailable".
  pickImageFiles(): Promise<string[]> {
    return rejectNotImplemented("pickImageFiles");
  }

  listProjectImages(_projectDir: string): Promise<MediaImageEntry[]> {
    return rejectNotImplemented("listProjectImages");
  }

  imageThumbnail(_filePath: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  inspectImage(_filePath: string): Promise<MediaImageDetails | null> {
    return Promise.resolve(null);
  }

  openExternal(_url: string): Promise<void> {
    return rejectNotImplemented("openExternal");
  }

  showInFolder(_filePath: string): Promise<void> {
    return rejectNotImplemented("showInFolder");
  }

  getStatus(): Promise<{ ok: boolean; runtime: string; name: string }> {
    return rejectNotImplemented("getStatus");
  }

  getLastProject(): Promise<string | null> {
    return rejectNotImplemented("getLastProject");
  }
  // No splash window on the web — these are safe no-ops (a PWA would use its own
  // loading UI, not a host splash).
  splashStatus(): Promise<void> {
    return Promise.resolve();
  }
  rendererReady(): Promise<void> {
    return Promise.resolve();
  }

  listProjectFiles(_projectDir: string): Promise<{ md: string[]; css: string[] }> {
    return rejectNotImplemented("listProjectFiles");
  }

  // Lint is non-essential chrome — degrade to "no warnings" rather than reject,
  // so a future PWA editor still renders without a gutter until lint lands.
  checkCss(_css: string, _from?: string): Promise<PrintSafeWarning[]> {
    return Promise.resolve([]);
  }

  // Same degrade-to-clean policy as checkCss: the Problems panel simply shows
  // "No problems found" on the web until a PWA lint backend exists.
  lintProject(_projectDir: string): Promise<ProblemEntry[]> {
    return Promise.resolve([]);
  }

  getViewerPrefs(): Promise<ViewerPrefs> {
    return rejectNotImplemented("getViewerPrefs");
  }

  setViewerPrefs(_patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> {
    return rejectNotImplemented("setViewerPrefs");
  }

  getViewerProjectState(_projectDir: string): Promise<ProjectState | null> {
    return rejectNotImplemented("getViewerProjectState");
  }

  setViewerProjectState(
    _projectDir: string,
    _patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }> {
    return rejectNotImplemented("setViewerProjectState");
  }

  // Settings (#45) — genuinely implemented on web via localStorage so the
  // settings store works even outside Electron.
  getSettings(): Promise<AppSettings> {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      const stored = raw ? (JSON.parse(raw) as DeepPartial<AppSettings>) : {};
      return Promise.resolve(deepMergeSettings(DEFAULT_SETTINGS, stored));
    } catch {
      return Promise.resolve(DEFAULT_SETTINGS);
    }
  }

  setSettings(patch: DeepPartial<AppSettings>): Promise<{ ok: boolean }> {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      const stored = raw ? (JSON.parse(raw) as DeepPartial<AppSettings>) : {};
      const merged = deepMergeSettings(deepMergeSettings(DEFAULT_SETTINGS, stored), patch);
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(merged));
      return Promise.resolve({ ok: true });
    } catch {
      return Promise.resolve({ ok: false });
    }
  }

  // Native (OS) theme (#48) — genuinely implemented via matchMedia so the
  // PWA / `vite dev` path themes correctly (not a 0.6.0 stub).
  getNativeTheme(): Promise<NativeThemeState> {
    const dark =
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
    return Promise.resolve({ shouldUseDarkColors: dark });
  }

  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void {
    if (typeof globalThis.matchMedia !== "function") return () => {};
    const mql = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) =>
      cb({ shouldUseDarkColors: e.matches });
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }

  getRecentFolders(): Promise<RecentFolderEntry[]> {
    return rejectNotImplemented("getRecentFolders");
  }

  getFavorites(): Promise<FavoriteEntry[]> {
    return rejectNotImplemented("getFavorites");
  }

  toggleFavorite(_folderPath: string, _title: string): Promise<{ favorited: boolean }> {
    return rejectNotImplemented("toggleFavorite");
  }

  removeRecent(_folderPath: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("removeRecent");
  }

  // Project discovery (#27) — no background filesystem scan on the PWA (File
  // System Access API restrictions). Resolve to [] so the Discovered section is
  // simply absent rather than erroring.
  discoverProjects(): Promise<DiscoveredProject[]> {
    return Promise.resolve([]);
  }

  classifyProject(_path: string): Promise<ProjectClassification> {
    return rejectNotImplemented("classifyProject");
  }

  // New-project scaffold (#25) — desktop-only in 0.4.0.
  createProject(_options: CreateProjectOptions): Promise<CreateProjectResult> {
    return rejectNotImplemented("createProject");
  }

  // ── Local version history (#13) — desktop-only; reject/empty on web ────────
  enableVersionHistory(_projectDir: string): Promise<ProjectClassification> {
    return rejectNotImplemented("enableVersionHistory");
  }

  saveSnapshot(_projectDir: string, _message?: string): Promise<SnapshotEntry> {
    return rejectNotImplemented("saveSnapshot");
  }

  // Resolve to [] (like listRecovery) so a history view simply renders empty.
  listSnapshots(_projectDir: string): Promise<SnapshotEntry[]> {
    return Promise.resolve([]);
  }

  // Empty page (matches listSnapshots) so a history view renders empty.
  listSnapshotsPage(
    _projectDir: string,
    _options?: ListSnapshotsOptions,
  ): Promise<SnapshotPage> {
    return Promise.resolve({ entries: [], hasMore: false });
  }

  restoreSnapshot(_projectDir: string, _id: string): Promise<RestoreVersionResult> {
    return rejectNotImplemented("restoreSnapshot");
  }

  // ── Managed GitHub integration (#15) — desktop-only; safe stubs on web ─────
  connectGitHubStart(): Promise<DeviceCodeInfo> {
    return rejectNotImplemented("connectGitHubStart");
  }

  connectGitHubWait(): Promise<RemoteConnection> {
    return rejectNotImplemented("connectGitHubWait");
  }

  connectGitHubCancel(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  disconnectGitHub(): Promise<{ ok: boolean }> {
    return rejectNotImplemented("disconnectGitHub");
  }

  // Resolve "not connected" so connection badges simply stay absent on web.
  getRemoteConnection(_host?: string): Promise<RemoteConnection> {
    return Promise.resolve({ connected: false });
  }

  listRemoteRepositories(): Promise<RemoteRepository[]> {
    return rejectNotImplemented("listRemoteRepositories");
  }

  listRemoteBranches(_owner: string, _repo: string): Promise<RemoteBranch[]> {
    return rejectNotImplemented("listRemoteBranches");
  }

  listRepoBooks(_owner: string, _repo: string, _branch: string): Promise<RepoBook[]> {
    return rejectNotImplemented("listRepoBooks");
  }

  cloneRemoteRepository(_args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
    return rejectNotImplemented("cloneRemoteRepository");
  }

  onCloneProgress(_cb: (data: CloneProgressEvent) => void): () => void {
    return () => {};
  }

  // ── Advanced Setup (#14) — desktop-only until the PWA lands ──────────────
  diagnoseProjectRemote(_projectDir: string): Promise<ProjectRemoteDiagnosis> {
    return rejectNotImplemented("diagnoseProjectRemote");
  }

  testRemoteAccess(_url: string): Promise<RemoteAccessResult> {
    return rejectNotImplemented("testRemoteAccess");
  }

  connectGenericHost(
    _args: ConnectGenericHostArgs,
  ): Promise<{ connected: boolean; host: string; username?: string }> {
    return rejectNotImplemented("connectGenericHost");
  }

  disconnectHost(_host: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("disconnectHost");
  }

  listHostConnections(): Promise<HostConnectionInfo[]> {
    return Promise.resolve([]);
  }

  forgeTokenUrl(_host: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // ── Auto-sync orchestrator seam — desktop-only; safe stubs on web ───────────
  // The ambient pill simply stays absent (no handler is ever called) when
  // running in a browser; setAutoSync is a silent no-op so callers need no guard.
  onSyncStatus(_handler: (status: SyncStatus) => void): () => void {
    // Never emits on the web — return a no-op unsubscribe.
    return () => {};
  }

  setAutoSync(_enabled: boolean): Promise<void> {
    // Auto-sync is desktop-only until the PWA sync backend lands in 0.6.0.
    return Promise.resolve();
  }

  // ── Sync (#15 sync phase) — desktop-only until the PWA lands ───────────────
  syncChanges(_projectDir: string, _message?: string): Promise<SyncOutcome> {
    return rejectNotImplemented("syncChanges");
  }

  resolveSyncConflicts(_args: ResolveSyncConflictsArgs): Promise<SyncOutcome> {
    return rejectNotImplemented("resolveSyncConflicts");
  }

  startPreview(_args: PreviewStartArgs): Promise<PreviewStartResult> {
    return rejectNotImplemented("startPreview");
  }

  stopPreview(): Promise<{ stopped: boolean }> {
    return rejectNotImplemented("stopPreview");
  }

  cancelExport(_exportId: string): Promise<{ canceled: boolean }> {
    return rejectNotImplemented("cancelExport");
  }

  build(_args: BuildArgs): Promise<BuildResult> {
    return rejectNotImplemented("build");
  }

  doctor(): Promise<unknown> {
    return rejectNotImplemented("doctor");
  }

  onBuildProgress(_cb: (data: ExportProgressEvent) => void): () => void {
    return () => {};
  }

  onUrlPreviewBlocked(_cb: (data: UrlPreviewBlockedEvent) => void): () => void {
    return () => {};
  }

  // ── Unsaved changes / recovery (#44) — desktop-only; reject/no-op on web ───
  writeRecovery(
    _filePath: string,
    _content: string,
    _baseMtimeMs: number,
  ): Promise<{ ok: boolean }> {
    return rejectNotImplemented("writeRecovery");
  }

  clearRecovery(_filePath: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("clearRecovery");
  }

  listRecovery(_projectDir: string): Promise<RecoveryEntry[]> {
    return Promise.resolve([]);
  }

  setDirtyState(_isDirty: boolean): Promise<void> {
    return rejectNotImplemented("setDirtyState");
  }

  onFlushBeforeClose(_cb: () => void): () => void {
    return () => {};
  }

  onFolderChanged(_cb: (data: FolderChangedEvent) => void): () => void {
    return () => {};
  }
}
