/**
 * ElectronAdapter — the ONLY module permitted to CALL methods on
 * `window.electron`. (`isDesktop()` in index.ts may test for its presence.)
 *
 * Every implemented method delegates 1:1 to the preload bridge, so behaviour is
 * identical to the pre-#41 direct calls. The #44 surface (statFile, watchFolder,
 * and the writeRecovery/clearRecovery/listRecovery/setDirtyState/onFlushBeforeClose/
 * onFolderChanged recovery methods) plus getSecret/setSecret (#12) are SCAFFOLDED
 * only — the contract/types exist but there is no IPC behind them yet, so they
 * throw a descriptive error rather than delegate to a non-existent bridge method.
 * Wire them up (preload + main IPC) when implementing #44 / #12.
 */
import type {
  Platform,
  ElectronBridge,
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
  NativeThemeState,
  DiscoveredProject,
  ProjectClassification,
  FileStat,
  RecoveryEntry,
  FolderChangedEvent,
} from "./contract";

function bridge(): ElectronBridge {
  const b = window.electron;
  if (!b) {
    throw new Error(
      "ElectronAdapter used outside Electron (window.electron is undefined). " +
        "Use getPlatform() so the correct adapter is selected.",
    );
  }
  return b;
}

export class ElectronAdapter implements Platform {
  readonly platform = "electron" as const;

  // ── PlatformAdapter primitives ──────────────────────────────────────────
  openFolder(): Promise<string | null> {
    return bridge().openDirectory();
  }

  readFile(path: string): Promise<string> {
    return bridge().readFile(path);
  }

  writeFile(path: string, content: string): Promise<void> {
    return bridge().writeFile(path, content);
  }

  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
    return bridge().listDir(path);
  }

  statFile(_path: string): Promise<FileStat> {
    throw new Error(
      "statFile is not implemented yet — file metadata IPC lands with #44 (currently scaffolded).",
    );
  }

  watchFolder(_path: string, _cb: () => void): () => void {
    throw new Error(
      "watchFolder is not implemented yet — folder-watch IPC lands with #44 (currently scaffolded).",
    );
  }

  getSecret(_key: string): Promise<string | null> {
    throw new Error(
      "getSecret is not implemented yet — OS keychain support lands with source modes (#12).",
    );
  }

  setSecret(_key: string, _value: string): Promise<void> {
    throw new Error(
      "setSecret is not implemented yet — OS keychain support lands with source modes (#12).",
    );
  }

  // ── HostServices ────────────────────────────────────────────────────────
  get apiVersion(): number {
    return bridge().apiVersion;
  }

  get updater(): UpdaterApi {
    return bridge().updater;
  }

  savePdf(defaultName?: string): Promise<string | null> {
    return bridge().savePdf(defaultName);
  }

  openExternal(url: string): Promise<void> {
    return bridge().openExternal(url);
  }

  showInFolder(filePath: string): Promise<void> {
    return bridge().showInFolder(filePath);
  }

  getStatus(): Promise<{ ok: boolean; runtime: string; name: string }> {
    return bridge().getStatus();
  }

  getLastProject(): Promise<string | null> {
    return bridge().getLastProject();
  }

  listProjectFiles(projectDir: string): Promise<{ md: string[]; css: string[] }> {
    return bridge().listProjectFiles(projectDir);
  }

  getViewerPrefs(): Promise<ViewerPrefs> {
    return bridge().getViewerPrefs();
  }

  setViewerPrefs(patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> {
    return bridge().setViewerPrefs(patch);
  }

  getViewerProjectState(projectDir: string): Promise<ProjectState | null> {
    return bridge().getViewerProjectState(projectDir);
  }

  setViewerProjectState(
    projectDir: string,
    patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }> {
    return bridge().setViewerProjectState(projectDir, patch);
  }

  getSettings(): Promise<AppSettings> {
    return bridge().getSettings();
  }

  setSettings(patch: DeepPartial<AppSettings>): Promise<{ ok: boolean }> {
    return bridge().setSettings(patch);
  }

  getNativeTheme(): Promise<NativeThemeState> {
    return bridge().getNativeTheme();
  }

  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void {
    return bridge().onNativeThemeUpdated(cb);
  }

  getRecentFolders(): Promise<RecentFolderEntry[]> {
    return bridge().getRecentFolders();
  }

  getFavorites(): Promise<FavoriteEntry[]> {
    return bridge().getFavorites();
  }

  toggleFavorite(folderPath: string, title: string): Promise<{ favorited: boolean }> {
    return bridge().toggleFavorite(folderPath, title);
  }

  removeRecent(folderPath: string): Promise<{ ok: boolean }> {
    return bridge().removeRecent(folderPath);
  }

  discoverProjects(): Promise<DiscoveredProject[]> {
    return bridge().discoverProjects();
  }

  classifyProject(path: string): Promise<ProjectClassification> {
    return bridge().classifyProject(path);
  }

  startPreview(args: PreviewStartArgs): Promise<PreviewStartResult> {
    return bridge().startPreview(args);
  }

  stopPreview(): Promise<{ stopped: boolean }> {
    return bridge().stopPreview();
  }

  cancelExport(exportId: string): Promise<{ canceled: boolean }> {
    return bridge().cancelExport(exportId);
  }

  build(args: BuildArgs): Promise<BuildResult> {
    return bridge().build(args);
  }

  doctor(): Promise<unknown> {
    return bridge().doctor();
  }

  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void {
    return bridge().onBuildProgress(cb);
  }

  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void {
    return bridge().onUrlPreviewBlocked(cb);
  }

  // ── Unsaved changes / recovery (#44) — SCAFFOLD ONLY (no IPC yet) ──────────
  writeRecovery(
    _filePath: string,
    _content: string,
    _baseMtimeMs: number,
  ): Promise<{ ok: boolean }> {
    throw new Error("writeRecovery is not implemented yet — recovery IPC lands with #44 (scaffolded).");
  }

  clearRecovery(_filePath: string): Promise<{ ok: boolean }> {
    throw new Error("clearRecovery is not implemented yet — recovery IPC lands with #44 (scaffolded).");
  }

  listRecovery(_projectDir: string): Promise<RecoveryEntry[]> {
    throw new Error("listRecovery is not implemented yet — recovery IPC lands with #44 (scaffolded).");
  }

  setDirtyState(_isDirty: boolean): Promise<void> {
    throw new Error("setDirtyState is not implemented yet — recovery IPC lands with #44 (scaffolded).");
  }

  onFlushBeforeClose(_cb: () => void): () => void {
    throw new Error("onFlushBeforeClose is not implemented yet — recovery IPC lands with #44 (scaffolded).");
  }

  onFolderChanged(_cb: (data: FolderChangedEvent) => void): () => void {
    throw new Error("onFolderChanged is not implemented yet — recovery IPC lands with #44 (scaffolded).");
  }
}
