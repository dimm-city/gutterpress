/**
 * ElectronAdapter — the ONLY module permitted to CALL methods on
 * `window.electron`. (`isDesktop()` in index.ts may test for its presence.)
 *
 * Every method delegates 1:1 to the preload bridge, so behaviour is identical
 * to the pre-#41 direct calls. `watchFolder`/`getSecret`/`setSecret` have no
 * existing IPC (they land with the in-app editor #38 and source modes #12), so
 * they throw a descriptive error rather than silently no-op.
 */
import type {
  Platform,
  ElectronBridge,
  ViewerPrefs,
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

  watchFolder(_path: string, _cb: () => void): () => void {
    throw new Error(
      "watchFolder is not implemented yet — wiring lands with the in-app editor (#38).",
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

  getViewerPrefs(): Promise<ViewerPrefs> {
    return bridge().getViewerPrefs();
  }

  setViewerPrefs(patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> {
    return bridge().setViewerPrefs(patch);
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
}
