/**
 * ElectronAdapter — the ONLY module permitted to CALL methods on
 * `window.electron`. (`isDesktop()` in index.ts may test for its presence.)
 *
 * Every implemented method delegates 1:1 to the preload bridge, so behaviour is
 * identical to the pre-#41 direct calls. The #44 surface (statFile, watchFolder,
 * and the writeRecovery/clearRecovery/listRecovery/onFlushBeforeClose/
 * onFolderChanged recovery methods) plus getSecret/setSecret (#12) are SCAFFOLDED
 * only — the contract/types exist but there is no IPC behind them yet, so they
 * throw a descriptive error rather than delegate to a non-existent bridge method.
 * Wire them up (preload + main IPC) when implementing #44 / #12.
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
  FileStat,
  FileWriteResult,
  RecoveryEntry,
  FolderChangedEvent,
  TemplateInfo,
  SnippetEntry,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ProjectStyle,
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
  RecoveryConfirmRequest,
  ConflictPreview,
  FolderRef,
  PlatformCapabilities,
} from "./contract";
import { basenameOf } from "./paths";

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
    const path = await bridge().openDirectory();
    if (path == null) return null;
    return { key: path, displayName: basenameOf(path) };
  }

  // On Electron the key IS the absolute path and the host always has standing
  // filesystem access — there is no handle to reload or permission to re-grant
  // (that is the PWA's concern). Re-opening a recent is just re-wrapping the
  // path as a FolderRef. (#33 Phase 3)
  reopenFolder(key: string): Promise<FolderRef> {
    return Promise.resolve({ key, displayName: basenameOf(key) });
  }

  readFile(path: string): Promise<string> {
    return bridge().readFile(path);
  }

  writeFile(path: string, content: string): Promise<FileWriteResult> {
    return bridge().writeFile(path, content);
  }

  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
    return bridge().listDir(path);
  }

  statFile(path: string): Promise<FileStat> {
    return bridge().statFile(path);
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

  // ── Project templates + snippets (#29) — delegate 1:1 to the bridge ─────────
  listBuiltInTemplates(): Promise<TemplateInfo[]> {
    return bridge().listBuiltInTemplates();
  }
  listCustomTemplates(): Promise<TemplateInfo[]> {
    return bridge().listCustomTemplates();
  }
  saveProjectAsTemplate(projectDir: string, name: string): Promise<TemplateInfo> {
    return bridge().saveProjectAsTemplate(projectDir, name);
  }
  importTemplateFromFolder(): Promise<TemplateInfo | null> {
    return bridge().importTemplateFromFolder();
  }
  listSnippets(projectDir: string): Promise<SnippetEntry[]> {
    return bridge().listSnippets(projectDir);
  }
  readSnippet(projectDir: string, fileName: string): Promise<string> {
    return bridge().readSnippet(projectDir, fileName);
  }
  saveSnippet(projectDir: string, name: string, body: string): Promise<SnippetEntry> {
    return bridge().saveSnippet(projectDir, name, body);
  }
  deleteSnippet(projectDir: string, fileName: string): Promise<void> {
    return bridge().deleteSnippet(projectDir, fileName);
  }

  // ── Plugin manager (#30) — delegate 1:1 to the bridge ──────────────────────
  listPlugins(projectDir: string): Promise<ProjectPluginEntry[]> {
    return bridge().listPlugins(projectDir);
  }
  setPluginEnabled(projectDir: string, ref: string, enabled: boolean): Promise<void> {
    return bridge().setPluginEnabled(projectDir, ref, enabled);
  }
  addNpmPlugin(projectDir: string, packageName: string): Promise<ProjectPluginEntry> {
    return bridge().addNpmPlugin(projectDir, packageName);
  }
  importLocalPlugin(projectDir: string): Promise<ProjectPluginEntry | null> {
    return bridge().importLocalPlugin(projectDir);
  }
  validatePlugins(projectDir: string): Promise<PluginValidationResult[]> {
    return bridge().validatePlugins(projectDir);
  }
  listRecommendedPlugins(): Promise<RecommendedPlugin[]> {
    return bridge().listRecommendedPlugins();
  }

  // ── Theme manager (#32) — delegate 1:1 to the bridge ───────────────────────
  listBuiltInThemes(): Promise<ThemeInfo[]> {
    return bridge().listBuiltInThemes();
  }
  listProjectThemes(projectDir: string): Promise<ThemeInfo[]> {
    return bridge().listProjectThemes(projectDir);
  }
  getActiveTheme(projectDir: string): Promise<ThemeInfo | null> {
    return bridge().getActiveTheme(projectDir);
  }
  applyTheme(projectDir: string, target: ApplyThemeTarget): Promise<ThemeInfo> {
    return bridge().applyTheme(projectDir, target);
  }
  importThemeFromFolder(projectDir: string): Promise<ThemeInfo | null> {
    return bridge().importThemeFromFolder(projectDir);
  }
  importThemeFromUrl(projectDir: string, url: string): Promise<ThemeInfo> {
    return bridge().importThemeFromUrl(projectDir, url);
  }
  readThemeCss(
    projectDir: string | null,
    source: { kind: "builtin" | "project"; id: string },
  ): Promise<string> {
    return bridge().readThemeCss(projectDir, source);
  }
  removeProjectTheme(projectDir: string, id: string): Promise<void> {
    return bridge().removeProjectTheme(projectDir, id);
  }

  // ── Style resolver (audit B2/G1) — delegate 1:1 to the bridge ──────────────
  listProjectStyles(projectDir: string): Promise<ProjectStyle[]> {
    return bridge().listProjectStyles(projectDir);
  }



  // ── Local version history (#13) — delegate 1:1 to the bridge ───────────────
  enableVersionHistory(projectDir: string): Promise<ProjectClassification> {
    return bridge().enableVersionHistory(projectDir);
  }

  saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry> {
    return bridge().saveSnapshot(projectDir, message);
  }

  listSnapshots(projectDir: string): Promise<SnapshotEntry[]> {
    return bridge().listSnapshots(projectDir);
  }

  listSnapshotsPage(
    projectDir: string,
    options?: ListSnapshotsOptions,
  ): Promise<SnapshotPage> {
    return bridge().listSnapshotsPage(projectDir, options);
  }

  restoreSnapshot(projectDir: string, id: string): Promise<RestoreVersionResult> {
    return bridge().restoreSnapshot(projectDir, id);
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

  disconnectGitHub(): Promise<{ ok: boolean }> {
    return bridge().disconnectGitHub();
  }

  getRemoteConnection(host?: string): Promise<RemoteConnection> {
    return bridge().getRemoteConnection(host);
  }

  listRemoteRepositories(): Promise<RemoteRepository[]> {
    return bridge().listRemoteRepositories();
  }

  listRemoteBranches(owner: string, repo: string): Promise<RemoteBranch[]> {
    return bridge().listRemoteBranches(owner, repo);
  }

  listRepoBooks(owner: string, repo: string, branch: string): Promise<RepoBook[]> {
    return bridge().listRepoBooks(owner, repo, branch);
  }

  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
    return bridge().cloneRemoteRepository(args);
  }

  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void {
    return bridge().onCloneProgress(cb);
  }

  // ── Advanced Setup (#14) ──────────────────────────────────────────────────
  diagnoseProjectRemote(projectDir: string): Promise<ProjectRemoteDiagnosis> {
    return bridge().diagnoseProjectRemote(projectDir);
  }

  testRemoteAccess(url: string): Promise<RemoteAccessResult> {
    return bridge().testRemoteAccess(url);
  }

  connectGenericHost(
    args: ConnectGenericHostArgs,
  ): Promise<{ connected: boolean; host: string; username?: string }> {
    return bridge().connectGenericHost(args);
  }

  disconnectHost(host: string): Promise<{ ok: boolean }> {
    return bridge().disconnectHost(host);
  }

  listHostConnections(): Promise<HostConnectionInfo[]> {
    return bridge().listHostConnections();
  }

  forgeTokenUrl(host: string): Promise<string | null> {
    return bridge().forgeTokenUrl(host);
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

  getConflictPreview(projectDir: string, path: string): Promise<ConflictPreview> {
    return bridge().getConflictPreview(projectDir, path);
  }

  // ── Sync (#15 sync phase) — delegate 1:1 to the bridge ─────────────────────
  syncChanges(projectDir: string, message?: string): Promise<SyncOutcome> {
    return bridge().syncChanges(projectDir, message);
  }

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

  // ── Unsaved changes / recovery (#44) — delegate 1:1 to the bridge ──────────
  writeRecovery(
    filePath: string,
    content: string,
    baseMtimeMs: number,
  ): Promise<{ ok: boolean }> {
    return bridge().writeRecovery(filePath, content, baseMtimeMs);
  }

  clearRecovery(filePath: string): Promise<{ ok: boolean }> {
    return bridge().clearRecovery(filePath);
  }

  listRecovery(projectDir: string): Promise<RecoveryEntry[]> {
    return bridge().listRecovery(projectDir);
  }

  // setDirtyState — migrated to server route (Phase 2B)

  onFlushBeforeClose(cb: () => void): () => void {
    return bridge().onFlushBeforeClose(cb);
  }

  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void {
    return bridge().onFolderChanged(cb);
  }
}
