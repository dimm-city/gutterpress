/**
 * ElectronAdapter — the ONLY module permitted to CALL methods on
 * `window.electron`. (`isDesktop()` in index.ts may test for its presence.)
 *
 * Every implemented method delegates 1:1 to the preload bridge, so behaviour is
 * identical to the pre-#41 direct calls. The #44 surface (statFile, watchFolder,
 * setDirtyState, onFlushBeforeClose, onFolderChanged) plus getSecret/setSecret (#12)
 * are SCAFFOLDED only — the contract/types exist but there is no IPC behind them yet,
 * so they throw a descriptive error rather than delegate to a non-existent bridge method.
 * Wire them up (preload + main IPC) when implementing #44 / #12.
 * writeRecovery/clearRecovery/listRecovery/getConflictPreview — migrated to server routes.
 */
import type {
  Platform,
  ElectronBridge,
  PreviewStartArgs,
  PreviewStartResult,
  BuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  UpdaterApi,
  NativeThemeState,
  ProjectClassification,
  // PrintSafeWarning, ProblemEntry, MediaImageEntry, MediaImageDetails — removed (Phase 2C)
  // TemplateInfo, SnippetEntry — removed (Phase 2D)
  // ProjectPluginEntry, PluginValidationResult, RecommendedPlugin, ThemeInfo, ApplyThemeTarget, ProjectStyle — removed (Phase 2E)
  FileStat,
  FileWriteResult,
  FolderChangedEvent,
  SnapshotEntry,
  DeviceCodeInfo,
  RemoteConnection,
  CloneProgressEvent,
  CloneRepositoryArgs,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  SyncStatus,
  RecoveryConfirmRequest,
  FolderRef,
  PlatformCapabilities,
} from "./contract";
import { basenameOf } from "./paths";
import { api } from "$lib/api";

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
  // #49: translation seam — the bridge returns the chosen absolute path (a
  // string); wrap it into a host-neutral FolderRef (key = path, displayName =
  // basename) so the renderer never assumes path-string semantics.
  async openFolder(): Promise<FolderRef | null> {
    const path = await api.dialog.openDirectory();
    if (path == null) return null;
    return { key: path, displayName: basenameOf(path) };
  }

  readFile(path: string): Promise<string> {
    return api.fs.readFile(path);
  }

  writeFile(path: string, content: string): Promise<FileWriteResult> {
    return api.fs.writeFile(path, content);
  }

  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
    return api.fs.listDir(path);
  }

  statFile(path: string): Promise<FileStat> {
    return api.fs.statFile(path);
  }

  watchFolder(path: string, cb: () => void): () => void {
    return bridge().watchFolder(path, cb);
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

  // #49: Electron is the full-capability host — native save paths, OS file
  // manager reveal, and persistent folder access are all available.
  capabilities(): PlatformCapabilities {
    return {
      nativeSavePath: true,
      showInFolder: true,
      persistentFolderAccess: true,
    };
  }

  // savePdf, pickImageFile, copyFile, pickImageFiles migrated to server routes
  // listProjectImages, imageThumbnail, inspectImage migrated to server routes (Phase 2C)
  // openExternal, showInFolder, readLogFile migrated to server routes
  // getStatus, checkCss, lintProject migrated to server routes (Phase 2C)
  // getLastProject, splashStatus, rendererReady — migrated to server routes (Phase 2B)
  // listProjectFiles migrated to server route

  // getViewerPrefs, setViewerPrefs, getViewerProjectState, setViewerProjectState,
  // getSettings, setSettings, getNativeTheme — migrated to server routes (Phase 2B)

  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void {
    return bridge().onNativeThemeUpdated(cb);
  }

  // getRecentFolders, getFavorites, toggleFavorite, removeRecent,
  // discoverProjects, classifyProject, createProject, adoptFolder
  // — migrated to server routes (Phase 2B)

  // tpl:* and snip:* migrated to server routes (Phase 2D) — removed from ElectronAdapter.
  // plugin:*, theme:*, project:listStyles migrated to server routes (Phase 2E) — removed from ElectronAdapter.

  // ── Local version history (#13) — all migrated to SvelteKit server routes (src/routes/api/vcs/*).

  saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry> {
    return api.vcs.saveSnapshot(projectDir, message);
  }

  // ── Managed GitHub integration (#15) — delegate 1:1 to the bridge ─────────
  connectGitHubStart(): Promise<DeviceCodeInfo> {
    return bridge().connectGitHubStart();
  }

  connectGitHubWait(): Promise<RemoteConnection> {
    return bridge().connectGitHubWait();
  }

  connectGitHubCancel(): Promise<{ ok: boolean }> {
    return bridge().connectGitHubCancel();
  }

  // disconnectGitHub, getRemoteConnection, listRemoteRepositories, listRemoteBranches,
  // listRepoBooks, diagnoseProjectRemote, testRemoteAccess, connectGenericHost,
  // disconnectHost, listHostConnections, forgeTokenUrl, syncChanges
  // — migrated to SvelteKit server routes (Phase 2F).

  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
    return bridge().cloneRemoteRepository(args);
  }

  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void {
    return bridge().onCloneProgress(cb);
  }

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ──
  onSyncStatus(handler: (status: SyncStatus) => void): () => void {
    return bridge().onSyncStatus(handler as (data: unknown) => void);
  }

  setAutoSync(enabled: boolean): Promise<void> {
    return bridge().setAutoSync(enabled);
  }

  // ── Sync recovery seam (Foundation — §8 / ADR 0004) ───────────────────────

  onRecoveryConfirm(handler: (req: RecoveryConfirmRequest) => void): () => void {
    return bridge().onRecoveryConfirm(handler as (data: unknown) => void);
  }

  respondRecoveryConfirm(requestId: string, approved: boolean): Promise<void> {
    return bridge().respondRecoveryConfirm(requestId, approved);
  }

  // getConflictPreview — migrated to server route (src/routes/api/sync/get-conflict-preview)

  // syncChanges — migrated to server route (Phase 2F).

  resolveSyncConflicts(args: ResolveSyncConflictsArgs): Promise<SyncOutcome> {
    return bridge().resolveSyncConflicts(args);
  }

  // #49: unwrap FolderRef.key → the string `input` the existing IPC expects.
  startPreview(args: PreviewStartArgs): Promise<PreviewStartResult> {
    const { input, ...rest } = args;
    return bridge().startPreview({ ...rest, input: input.key });
  }

  stopPreview(): Promise<{ stopped: boolean }> {
    return bridge().stopPreview();
  }

  cancelExport(exportId: string): Promise<{ canceled: boolean }> {
    return bridge().cancelExport(exportId);
  }

  // #49: unwrap FolderRef.key → the string `input` the existing IPC expects.
  build(args: BuildArgs): Promise<BuildResult> {
    const { input, ...rest } = args;
    return bridge().build({ ...rest, input: input.key });
  }

  // doctor migrated to server route (Phase 2C)

  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void {
    return bridge().onBuildProgress(cb);
  }

  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void {
    return bridge().onUrlPreviewBlocked(cb);
  }

  // writeRecovery, clearRecovery, listRecovery — migrated to server routes
  // (src/routes/api/recovery/*) via globalThis hooks registered in main.ts.

  // setDirtyState — migrated to server route (Phase 2B)

  onFlushBeforeClose(cb: () => void): () => void {
    return bridge().onFlushBeforeClose(cb);
  }

  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void {
    return bridge().onFolderChanged(cb);
  }
}
