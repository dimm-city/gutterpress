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
  TemplateInfo,
  SnippetEntry,
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
  FileRef,
  PlatformCapabilities,
} from "./contract";
import { basenameOf, fileRef } from "./paths";

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

  savePdf(defaultName?: string): Promise<string | null> {
    return bridge().savePdf(defaultName);
  }

  // Image pick / copy (#31) — editor toolbar Insert Image flow.
  // #61: translation seam — the bridge returns the chosen path string; wrap it
  // into a host-neutral FileRef (key = path, displayName = basename).
  async pickImageFile(): Promise<FileRef | null> {
    const path = await bridge().pickImageFile();
    return path == null ? null : fileRef(path);
  }

  copyFile(srcPath: string, destDir: string): Promise<string> {
    return bridge().copyFile(srcPath, destDir);
  }

  // Media panel (#47) — image listing / thumbnails / inspection / multi-import
  pickImageFiles(): Promise<string[]> {
    return bridge().pickImageFiles();
  }

  listProjectImages(projectDir: string): Promise<MediaImageEntry[]> {
    return bridge().listProjectImages(projectDir);
  }

  imageThumbnail(filePath: string): Promise<string | null> {
    return bridge().imageThumbnail(filePath);
  }

  inspectImage(filePath: string): Promise<MediaImageDetails | null> {
    return bridge().inspectImage(filePath);
  }

  openExternal(url: string): Promise<void> {
    return bridge().openExternal(url);
  }

  showInFolder(filePath: string): Promise<void> {
    return bridge().showInFolder(filePath);
  }

  readLogFile(filePath: string): Promise<string | null> {
    return bridge().readLogFile(filePath);
  }

  getStatus(): Promise<{ ok: boolean; runtime: string; name: string }> {
    return bridge().getStatus();
  }

  getLastProject(): Promise<string | null> {
    return bridge().getLastProject();
  }
  splashStatus(status?: string, progress?: number, sub?: string): Promise<void> {
    return bridge().splashStatus(status, progress, sub);
  }
  rendererReady(): Promise<void> {
    return bridge().rendererReady();
  }

  listProjectFiles(projectDir: string): Promise<{ md: string[]; css: string[] }> {
    return bridge().listProjectFiles(projectDir);
  }

  checkCss(css: string, from?: string): Promise<PrintSafeWarning[]> {
    return bridge().checkCss(css, from);
  }

  lintProject(projectDir: string): Promise<ProblemEntry[]> {
    return bridge().lintProject(projectDir);
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

  // #49: the bridge returns raw path-keyed rows; map each to a FolderRef-shaped
  // entry (key = path, displayName = basename) for the app-facing contract.
  async getRecentFolders(): Promise<RecentFolderEntry[]> {
    const rows = await bridge().getRecentFolders();
    return rows.map((r) => ({
      key: r.path,
      displayName: basenameOf(r.path),
      title: r.title,
      openedAt: r.openedAt,
      exists: r.exists,
    }));
  }

  async getFavorites(): Promise<FavoriteEntry[]> {
    const rows = await bridge().getFavorites();
    return rows.map((f) => ({
      key: f.path,
      displayName: basenameOf(f.path),
      title: f.title,
      exists: f.exists,
    }));
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

  createProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
    return bridge().createProject(options);
  }

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

  doctor(): Promise<unknown> {
    return bridge().doctor();
  }

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

  setDirtyState(isDirty: boolean): Promise<void> {
    return bridge().setDirtyState(isDirty);
  }

  onFlushBeforeClose(cb: () => void): () => void {
    return bridge().onFlushBeforeClose(cb);
  }

  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void {
    return bridge().onFolderChanged(cb);
  }
}
