import { contextBridge, ipcRenderer } from "electron";
import type {
  UpdaterEventPayload,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  RawPreviewStartArgs,
  PreviewStartResult,
  RawBuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
  EditorProjectionHostArgs,
  EditorProjectionOutcome,
  DirEntry,
  FileStat,
  FileWriteResult,
  ProjectFileEntry,
  LogFileEntry,
  DesktopPrefs,
  ProjectState,
  DiscoveredProject,
  ProjectClassification,
  AppImageStatus,
  AppImageInstallResult,
  AppImageRemoveResult,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  TemplateInfo,
  SavedTemplateInfo,
  SnippetEntry,
  ProjectConfigFields,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectStyle,
  MediaImageEntry,
  MediaImageDetails,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishRunResult,
  PublishProviderStaticInfo,
  PreflightRow,
  CloneRepositoryArgs,
  SyncOutcome,
} from "./bridge-types";
/**
 * Integer IPC-surface contract version shared between the Electron shell and
 * the SvelteKit SPA. Bump ONLY when an ipcMain.handle() method that the SPA
 * calls is added or removed. With full-app updates (electron-updater) the
 * shell and SPA always ship together, so this is a sanity check rather than a
 * version-skew gate.
 *
 * 3 -> 4 (ARCH review #8): removed updater:getStatus/check/download,
 * sync:setAutoSync, remote:cloneRepository —
 * migrated to SvelteKit server routes (plain request/response, no push
 * stream or live-BrowserWindow need).
 * 4 -> 5 (public seams V3): added the `.md` launch ready handshake; the file
 * events themselves are a main→renderer push stream.
 * 5 -> 6 (SFE-P3e): added `api:editorProjection` — the desktop rich editor's
 * host-built, plugin-aware projection call.
 */
// 6 -> 7 (SFE-P5c1): added `fs`, `dialog`, `shell`, `log`, `app` -- the five
// route groups migrated from SvelteKit HTTP routes to typed IPC. The routes
// and their `api.ts` client methods are deleted in the same run.
// 7 -> 8 (SFE-P5c2): added `project`, `manifest`, `tpl`, `snip`, `media`,
// `plugin`, `theme`, `vcs`, `style` -- the nine route groups migrated from
// SvelteKit HTTP routes to typed IPC in the same run.
// 8 -> 9 (SFE-P5c3): added `remote`, `sync`, `publish` -- the credentials-
// sensitive group restored from SvelteKit HTTP routes to typed IPC in the
// same run. connectGitHubStart/Wait/Cancel, onCloneProgress, onSyncStatus
// were already on this bridge and are unchanged.
const DESKTOP_API = 9;

/**
 * Bridge exposed to the SvelteKit renderer as window.electron.
 * Renderer never imports node:* or electron itself — all native work
 * happens here, in the preload, or in main via ipcRenderer.invoke.
 *
 * Shared IPC payload types (UpdaterStatus, SyncOutcome, AppSettings, etc.)
 * are imported from ./bridge-types (which re-exports from
 * src/lib/platform/shared-types.ts). No more duplicate type declarations.
 */

// ── Types used only in preload (not shared with the renderer contract) ────

// New-project scaffold types (CreateProjectOptions/AdoptFolderOptions/
// CreateProjectResult) removed — app:createProject/app:adoptFolder migrated
// to server routes (Phase 2B), leaving the local mirrors unreferenced; the
// real shapes live in the lib's project-scaffold.ts.

// plugin:*, theme:*, project:listStyles types were removed here when that
// surface migrated to server routes (Phase 2E) and are back as of SFE-P5c2
// (imported from ./bridge-types at the top of this file, same as every
// other IPC payload type). This block used to also declare module-local
// `StyleToken`/`RecentFolderEntry`/`FavoriteEntry`/`DiscoveredProject`
// interfaces left behind by that migration and never referenced anywhere in
// this file — those (StyleToken excepted — SPA-only, never crossed the
// bridge) live in src/lib/platform/dtos.ts. Removed in the 2026-07-28
// duplication audit; see docs/reviews/duplication-audit-2026-07-28.md.

// Local version history (#13): `SnapshotEntry` / `SnapshotPage` /
// `RestoreVersionResult` / `ProjectClassification` are defined in
// `src/lib/platform/shared-types.ts` (or dtos.ts for `ProjectClassification`)
// and re-exported here via `electron/bridge-types.ts`.

// ──────────────────────────────────────────────────────────────────────────
// Safe push-event forwarding (main → renderer).
//
// EVERY main→renderer subscription MUST go through forwardPush. Two hard
// rules, learned from the 0.5.0-rc.3 clone-progress storm:
//
//  1. Never pass the raw IpcRendererEvent across the contextBridge — only
//     the plain, structured-clone-safe payload.
//  2. Never let the callback's RETURN VALUE cross back into the preload.
//     contextBridge synchronously serializes a bridged function's return
//     value with the structured-clone algorithm. A Svelte 5 `$state`
//     assignment expression (`(p) => (someState = p)`) returns the reactive
//     Proxy, which is not cloneable — every event then throws
//     "Uncaught Error: An object could not be cloned." at the cb call site,
//     thousands of times during a clone. We cannot stop contextBridge from
//     serializing the return value, so the call is wrapped in try/catch and
//     failures are reported ONCE per channel instead of as an uncaught
//     exception storm.
// ──────────────────────────────────────────────────────────────────────────
const warnedPushChannels = new Set<string>();
function forwardPush<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_e: unknown, data: T) => {
    try {
      cb(data);
    } catch (err) {
      if (!warnedPushChannels.has(channel)) {
        warnedPushChannels.add(channel);
        console.warn(
          `[preload] listener for "${channel}" threw (reported once; ` +
            `usually a non-cloneable callback return value):`,
          err,
        );
      }
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("electron", {
  // ──────────────────────────────────────────────────────────────────────
  // API version contract, exposed for a future renderer-vs-shell version check
  // (audit D4). NOTE: no renderer code reads this yet — the previous comment
  // claimed the renderer "checks this to refuse running against a stale shell,"
  // but that check was never implemented. Kept as the plumbing that check will
  // use; read it in the renderer before relying on it to gate anything.
  // ──────────────────────────────────────────────────────────────────────
  apiVersion: DESKTOP_API,

  // ──────────────────────────────────────────────────────────────────────
  // Desktop update surface (electron-updater + macOS check-only notifier)
  // getStatus/check/download migrated to server routes (api.updater.*) —
  // ARCH review #8: plain request/response, no push stream or
  // live-BrowserWindow need. applyNow stays IPC: it flushes the live
  // renderer's unsaved buffer via `mainWindow.webContents.send` before
  // quitting — a live-BrowserWindow call §8 sanctions.
  // ──────────────────────────────────────────────────────────────────────
  updater: {
    applyNow: (): Promise<{ applied: boolean; version?: string; error?: string }> =>
      ipcRenderer.invoke("updater:applyNow"),
    /** Subscribe to updater events from main. Returns an unsubscribe fn. */
    onEvent: (cb: (data: UpdaterEventPayload) => void): (() => void) =>
      forwardPush("updater:event", cb),
  },

  // ── fs / dialog / shell / log / app — typed IPC (SFE-P5c1) ────────────────
  // media:* moved to typed IPC too, but in SFE-P5c2 — see the `media` block
  // below. checkCss, lintProject stay server routes (lint:*, P5c4).
  fs: {
    readFile: (path: string): Promise<string> => ipcRenderer.invoke("fs:readFile", path),
    writeFile: (path: string, content: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke("fs:writeFile", path, content),
    statFile: (path: string): Promise<FileStat> => ipcRenderer.invoke("fs:statFile", path),
    listDir: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke("fs:listDir", path),
    listProjectFiles: (projectDir: string): Promise<ProjectFileEntry> =>
      ipcRenderer.invoke("fs:listProjectFiles", projectDir),
    createFile: (dir: string, name: string, content: string): Promise<{ path: string; mtimeMs: number }> =>
      ipcRenderer.invoke("fs:createFile", dir, name, content),
    createFolder: (dir: string, name: string): Promise<{ path: string }> =>
      ipcRenderer.invoke("fs:createFolder", dir, name),
    renamePath: (path: string, newName: string): Promise<{ path: string }> =>
      ipcRenderer.invoke("fs:rename", path, newName),
    deletePath: (path: string, projectDir: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke("fs:delete", path, projectDir),
  },

  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
    savePdf: (defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke("dialog:savePdf", defaultName),
    pickImageFile: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickImageFile"),
    pickPdfFile: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickPdfFile"),
    pickImageFiles: (): Promise<string[]> => ipcRenderer.invoke("dialog:pickImageFiles"),
  },

  shell: {
    openExternal: (url: string): Promise<{ ok: true }> => ipcRenderer.invoke("shell:openExternal", url),
    showInFolder: (filePath: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke("shell:showInFolder", filePath),
  },

  log: {
    read: (logPath: string): Promise<string | null> => ipcRenderer.invoke("log:read", logPath),
    list: (): Promise<LogFileEntry[]> => ipcRenderer.invoke("log:list"),
  },

  app: {
    getDesktopPrefs: (): Promise<DesktopPrefs> => ipcRenderer.invoke("app:getDesktopPrefs"),
    setDesktopPrefs: (prefs: Record<string, unknown>): Promise<{ ok: true }> =>
      ipcRenderer.invoke("app:setDesktopPrefs", prefs),
    getDesktopProjectState: (projectDir: string): Promise<ProjectState | null> =>
      ipcRenderer.invoke("app:getDesktopProjectState", projectDir),
    setDesktopProjectState: (projectDir: string, state: Record<string, unknown>): Promise<{ ok: true }> =>
      ipcRenderer.invoke("app:setDesktopProjectState", projectDir, state),
    getSettings: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("app:getSettings"),
    setSettings: (settings: Record<string, unknown>): Promise<{ ok: true }> =>
      ipcRenderer.invoke("app:setSettings", settings),
    getNativeTheme: (): Promise<{ shouldUseDarkColors: boolean }> =>
      ipcRenderer.invoke("app:getNativeTheme"),
    getRecentFolders: (): Promise<
      Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>
    > => ipcRenderer.invoke("app:getRecentFolders"),
    getFavorites: (): Promise<Array<{ path: string; title: string; exists: boolean }>> =>
      ipcRenderer.invoke("app:getFavorites"),
    toggleFavorite: (path: string, title: string): Promise<{ favorited: boolean }> =>
      ipcRenderer.invoke("app:toggleFavorite", path, title),
    removeRecent: (path: string): Promise<{ ok: true }> => ipcRenderer.invoke("app:removeRecent", path),
    discoverProjects: (): Promise<DiscoveredProject[]> => ipcRenderer.invoke("app:discoverProjects"),
    classifyProject: (projectDir: string): Promise<ProjectClassification> =>
      ipcRenderer.invoke("app:classifyProject", projectDir),
    createProject: (options: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke("app:createProject", options),
    adoptFolder: (options: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke("app:adoptFolder", options),
    setDirtyState: (dirty: boolean): Promise<{ ok: true }> => ipcRenderer.invoke("app:setDirtyState", dirty),
    recordFlushFailure: (projectDir: string | null): Promise<{ failedAt: string; projectDir?: string }> =>
      ipcRenderer.invoke("app:recordFlushFailure", projectDir),
    acknowledgeFlushFailure: (failedAt: string): Promise<{ acknowledged: boolean }> =>
      ipcRenderer.invoke("app:acknowledgeFlushFailure", failedAt),
    appImageIntegration: {
      getStatus: (): Promise<AppImageStatus> => ipcRenderer.invoke("app:appImageIntegrationStatus"),
      install: (): Promise<AppImageInstallResult> => ipcRenderer.invoke("app:appImageIntegrationInstall"),
      remove: (): Promise<AppImageRemoveResult> => ipcRenderer.invoke("app:appImageIntegrationRemove"),
    },
  },

  // ── project / manifest / tpl / snip / media / plugin / theme / vcs / style
  // — typed IPC (SFE-P5c2) ──────────────────────────────────────────────────
  // checkCss / lintProject stay server routes (lint:*, P5c4).

  project: {
    listStyles: (projectDir: string, repoRoot?: string | null): Promise<ProjectStyle[]> =>
      ipcRenderer.invoke("project:listStyles", projectDir, repoRoot ?? undefined),
  },

  manifest: {
    read: (projectDir: string): Promise<ProjectConfigFields> => ipcRenderer.invoke("manifest:read", projectDir),
    setFields: (projectDir: string, updates: ProjectConfigFields): Promise<ProjectConfigFields> =>
      ipcRenderer.invoke("manifest:setFields", projectDir, updates),
  },

  tpl: {
    listBuiltIn: (): Promise<TemplateInfo[]> => ipcRenderer.invoke("tpl:listBuiltIn"),
    listCustom: (): Promise<TemplateInfo[]> => ipcRenderer.invoke("tpl:listCustom"),
    saveAsTemplate: (opts: {
      projectDir: string;
      name: string;
      sharedRefs?: "vendor" | "exclude";
    }): Promise<SavedTemplateInfo> =>
      ipcRenderer.invoke("tpl:saveAsTemplate", opts.projectDir, opts.name, opts.sharedRefs),
    importFromFolder: (): Promise<TemplateInfo | null> => ipcRenderer.invoke("tpl:importFromFolder"),
  },

  snip: {
    list: (projectDir: string): Promise<SnippetEntry[]> => ipcRenderer.invoke("snip:list", projectDir),
    read: (projectDir: string, fileName: string): Promise<string> =>
      ipcRenderer.invoke("snip:read", projectDir, fileName),
    save: (projectDir: string, name: string, body: string): Promise<SnippetEntry> =>
      ipcRenderer.invoke("snip:save", projectDir, name, body),
    delete: (projectDir: string, fileName: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("snip:delete", projectDir, fileName),
  },

  media: {
    listImages: (projectDir: string): Promise<MediaImageEntry[]> =>
      ipcRenderer.invoke("media:listImages", projectDir),
    thumbnail: (imagePath: string): Promise<string | null> => ipcRenderer.invoke("media:thumbnail", imagePath),
    inspect: (imagePath: string): Promise<MediaImageDetails | null> =>
      ipcRenderer.invoke("media:inspect", imagePath),
    importImage: (projectDir: string, src: string): Promise<{ src: string; copied: boolean }> =>
      ipcRenderer.invoke("media:importImage", projectDir, src),
  },

  plugin: {
    list: (projectDir: string): Promise<ProjectPluginEntry[]> => ipcRenderer.invoke("plugin:list", projectDir),
    setEnabled: (projectDir: string, ref: string, enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("plugin:setEnabled", projectDir, ref, enabled),
    addNpm: (projectDir: string, packageName: string, exportName?: string): Promise<ProjectPluginEntry | null> =>
      ipcRenderer.invoke("plugin:addNpm", projectDir, packageName, exportName),
    addLocal: (projectDir: string): Promise<ProjectPluginEntry | null> =>
      ipcRenderer.invoke("plugin:addLocal", projectDir),
    validate: (projectDir: string): Promise<PluginValidationResult[]> =>
      ipcRenderer.invoke("plugin:validate", projectDir),
    recommended: (): Promise<RecommendedPlugin[]> => ipcRenderer.invoke("plugin:recommended"),
  },

  theme: {
    listBuiltIn: (): Promise<ThemeInfo[]> => ipcRenderer.invoke("theme:listBuiltIn"),
    listProject: (projectDir: string): Promise<ThemeInfo[]> => ipcRenderer.invoke("theme:listProject", projectDir),
    getActive: (projectDir: string): Promise<ThemeInfo | null> => ipcRenderer.invoke("theme:getActive", projectDir),
    apply: (projectDir: string, target: ApplyThemeTarget): Promise<ThemeInfo> =>
      ipcRenderer.invoke("theme:apply", projectDir, target),
    importFromFolder: (projectDir: string): Promise<ThemeInfo | null> =>
      ipcRenderer.invoke("theme:importFromFolder", projectDir),
    importFromFile: (projectDir: string): Promise<ThemeImportResult | null> =>
      ipcRenderer.invoke("theme:importFromFile", projectDir),
    importFromUrl: (projectDir: string, url: string): Promise<ThemeInfo> =>
      ipcRenderer.invoke("theme:importFromUrl", projectDir, url),
    readCss: (projectDir: string | null, source: { kind: "builtin" | "project"; id: string }): Promise<string> =>
      ipcRenderer.invoke("theme:readCss", projectDir, source),
    remove: (projectDir: string, id: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke("theme:remove", projectDir, id),
    getPrevious: (projectDir: string): Promise<ThemeInfo | null> =>
      ipcRenderer.invoke("theme:getPrevious", projectDir),
    revert: (projectDir: string): Promise<ThemeInfo> => ipcRenderer.invoke("theme:revert", projectDir),
  },

  vcs: {
    enableVersionHistory: (projectDir: string): Promise<unknown> =>
      ipcRenderer.invoke("vcs:enableVersionHistory", projectDir),
    listSnapshotsPage: (
      projectDir: string,
      options?: { limit?: number; before?: string },
    ): Promise<SnapshotPage> =>
      ipcRenderer.invoke("vcs:listSnapshotsPage", projectDir, options?.limit, options?.before),
    restoreSnapshot: (projectDir: string, id: string): Promise<RestoreVersionResult> =>
      ipcRenderer.invoke("vcs:restoreSnapshot", projectDir, id),
    saveSnapshot: (projectDir: string, message?: string): Promise<SnapshotEntry> =>
      ipcRenderer.invoke("vcs:saveSnapshot", projectDir, message),
  },

  style: {
    setActive: (projectDir: string, paths: string[]): Promise<string[]> =>
      ipcRenderer.invoke("style:setActive", projectDir, paths),
  },

  // ── remote / sync / publish — typed IPC (SFE-P5c3, the credentials-
  // sensitive group) ────────────────────────────────────────────────────────
  // connectGitHubStart/Wait/Cancel, onCloneProgress, onSyncStatus are the
  // top-level flat members further below (predate the namespaced-object
  // convention P5c1/P5c2 established) — unchanged by this run.

  remote: {
    disconnectGitHub: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("remote:disconnectGitHub"),
    getConnection: (host?: string): Promise<{ connected: boolean; username?: string; label?: string }> =>
      ipcRenderer.invoke("remote:getConnection", host),
    listRepositories: (): Promise<RemoteRepository[]> => ipcRenderer.invoke("remote:listRepositories"),
    listBranches: (owner: string, repo: string): Promise<RemoteBranch[]> =>
      ipcRenderer.invoke("remote:listBranches", owner, repo),
    listRepoBooks: (owner: string, repo: string, branch: string): Promise<RepoBook[]> =>
      ipcRenderer.invoke("remote:listRepoBooks", owner, repo, branch),
    diagnoseProject: (projectDir: string): Promise<ProjectRemoteDiagnosis> =>
      ipcRenderer.invoke("remote:diagnoseProject", projectDir),
    testRemoteAccess: (url: string): Promise<RemoteAccessResult> =>
      ipcRenderer.invoke("remote:testRemoteAccess", url),
    connectGenericHost: (
      args: ConnectGenericHostArgs,
    ): Promise<{ connected: boolean; host: string; username?: string }> =>
      ipcRenderer.invoke("remote:connectGenericHost", args),
    disconnectHost: (host: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("remote:disconnectHost", host),
    listConnections: (): Promise<HostConnectionInfo[]> => ipcRenderer.invoke("remote:listConnections"),
    forgeTokenUrl: (host: string): Promise<string | null> => ipcRenderer.invoke("remote:forgeTokenUrl", host),
    sync: (projectDir: string, message?: string): Promise<SyncOutcome> =>
      ipcRenderer.invoke("remote:sync", projectDir, message),
    cloneRepository: (args: CloneRepositoryArgs): Promise<{ projectDir: string }> =>
      ipcRenderer.invoke("remote:cloneRepository", args),
  },

  sync: {
    setAutoSync: (enabled: boolean): Promise<{ ok: boolean; autoSync: boolean }> =>
      ipcRenderer.invoke("sync:setAutoSync", enabled),
    /** The last "sync:status" payload emitted for `projectDir`, or null. */
    getStatus: (projectDir: string): Promise<object | null> => ipcRenderer.invoke("sync:getStatus", projectDir),
  },

  publish: {
    listProviders: (projectDir: string): Promise<PublishProviderCard[]> =>
      ipcRenderer.invoke("publish:list", projectDir),
    providers: (): Promise<PublishProviderStaticInfo[]> => ipcRenderer.invoke("publish:providers"),
    connect: (
      projectDir: string,
      providerId: string,
      token: string,
      account?: string,
    ): Promise<{ connected: boolean; providerId: string }> =>
      ipcRenderer.invoke("publish:connect", projectDir, providerId, token, account),
    disconnect: (providerId: string, account?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke("publish:disconnect", providerId, account),
    setConfig: (
      projectDir: string,
      providerId: string,
      values: Record<string, string>,
    ): Promise<Record<string, Record<string, unknown>>> =>
      ipcRenderer.invoke("publish:setConfig", projectDir, providerId, values),
    preflight: (projectDir: string, providerIds: string[]): Promise<PreflightRow[]> =>
      ipcRenderer.invoke("publish:preflight", projectDir, providerIds),
    run: (
      projectDir: string,
      providerId: string,
      options?: { dryRun?: boolean; artifactPath?: string },
    ): Promise<PublishRunResult> =>
      ipcRenderer.invoke("publish:run", projectDir, providerId, options?.artifactPath, options?.dryRun),
  },

  /**
   * Watch a project folder for changes (#44). Subscribes to debounced
   * `fs:folderChanged` events for `dirPath` and returns an unsubscribe fn that
   * tears down the main-process watcher. The renderer never sees raw fs events.
   */
  watchFolder: (dirPath: string, cb: () => void): (() => void) => {
    const off = forwardPush("fs:folderChanged", () => cb());
    void ipcRenderer.invoke("fs:watchFolder", dirPath);
    return () => {
      off();
      void ipcRenderer.invoke("fs:unwatchFolder", dirPath);
    };
  },

  // getStatus migrated to server route (Phase 2C)
  // app:getLastProject has no route/IPC — never implemented as a distinct op.

  // Native (OS) theme surface (#48) — push channel kept as IPC (main→renderer)
  /** Subscribe to OS theme changes from main. Returns an unsubscribe fn. */
  onNativeThemeUpdated: (
    cb: (data: { shouldUseDarkColors: boolean }) => void
  ): (() => void) => forwardPush("app:nativeThemeUpdated", cb),

  /**
   * Subscribe before telling main the UI is ready, so startup/second-instance
   * paths queued before hydration cannot be lost between load and onMount.
   */
  onOpenMarkdownFile: (
    cb: (data: MarkdownFileLaunchEvent) => void,
  ): (() => void) => {
    const off = forwardPush("app:openMarkdownFile", cb);
    void ipcRenderer.invoke("app:openMarkdownFileReady").catch((err) => {
      console.warn("[preload] Markdown file-launch handshake failed:", err);
      // Do not strand the SPA behind its startup gate if main is unavailable.
      try {
        cb({ type: "ready" });
      } catch {
        /* renderer callback failed; forwardPush applies the same containment */
      }
    });
    return off;
  },

  // tpl:*, snip:*, plugin:*, theme:*, project:listStyles, and local version
  // history (#13) round-tripped through SvelteKit server routes (Phase
  // 2D/2E) and are back on this bridge as of SFE-P5c2 — see the `project`/
  // `manifest`/`tpl`/`snip`/`media`/`plugin`/`theme`/`vcs`/`style` blocks
  // above.

  // ── Managed GitHub integration (#15) — device flow + repo picker + clone ──
  // Two-phase connect: Start returns the user code to display; Wait resolves
  // when the user approves in the browser. Tokens never cross this bridge.
  connectGitHubStart: (): Promise<DeviceCodeInfo> =>
    ipcRenderer.invoke("remote:connectGitHubStart"),
  connectGitHubWait: (): Promise<RemoteConnection> =>
    ipcRenderer.invoke("remote:connectGitHubWait"),
  connectGitHubCancel: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("remote:connectGitHubCancel"),
  // disconnectGitHub, getConnection, listRepositories, listBranches,
  // listRepoBooks, diagnoseProject, testRemoteAccess, connectGenericHost,
  // disconnectHost, listConnections, forgeTokenUrl, sync, cloneRepository —
  // SFE-P5c3: restored to typed IPC on the `remote` namespaced block above
  // (request/reply operations only — the push channel below is unaffected,
  // run rule 8).
  /** Subscribe to clone progress from main. Returns an unsubscribe fn. */
  onCloneProgress: (cb: (data: CloneProgressEvent) => void): (() => void) =>
    forwardPush("remote:cloneProgress", cb),

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ─
  // Main emits `sync:status` push events whenever the orchestrator state machine
  // transitions. The renderer subscribes via onSyncStatus to drive the ambient
  // pill without polling. setAutoSync/getStatus are the `sync` namespaced
  // block above (SFE-P5c3: restored to typed IPC).

  /** Subscribe to ambient sync-status push events. Returns an unsubscribe fn. */
  onSyncStatus: (cb: (data: unknown) => void): (() => void) =>
    forwardPush("sync:status", cb),

  // getConflictPreview — migrated to server route (src/routes/api/sync/get-conflict-preview)
  // resolveSyncConflicts — dead (removed before this run; sync always converges).

  startPreview: (args: RawPreviewStartArgs): Promise<PreviewStartResult> =>
    ipcRenderer.invoke("api:preview", args),
  stopPreview: (): Promise<{ stopped: boolean }> =>
    ipcRenderer.invoke("api:stopPreview"),
  cancelExport: (exportId: string): Promise<{ canceled: boolean }> =>
    ipcRenderer.invoke("api:cancelExport", exportId),
  build: (args: RawBuildArgs): Promise<BuildResult> =>
    ipcRenderer.invoke("api:build", args),
  // doctor migrated to server route (Phase 2C)

  // SFE-P3e: the desktop rich editor's plugin-aware projection, built
  // host-side (real manifest + real loaded plugins) — see
  // electron/editor-projection.ts and main.ts's "api:editorProjection"
  // handler for the validated boundary. Resolves to a discriminated
  // `EditorProjectionOutcome`, never a `.code`-tagged rejection (SFE-P3e
  // review round 2 — see editor-projection.ts's header for why).
  buildEditorProjection: (args: EditorProjectionHostArgs): Promise<EditorProjectionOutcome> =>
    ipcRenderer.invoke("api:editorProjection", args),

  // Live PDF-build progress (main → renderer). Returns an unsubscribe fn.
  onBuildProgress: (
    cb: (data: ExportProgressEvent) => void
  ): (() => void) => forwardPush("build:progress", cb),

  onUrlPreviewBlocked: (
    cb: (data: UrlPreviewBlockedEvent) => void
  ): (() => void) => forwardPush("url-preview:blocked", cb),

  // writeRecovery, clearRecovery, listRecovery — migrated to server routes
  // (src/routes/api/recovery/*) via globalThis hooks registered in main.ts.

  /**
   * Subscribe to main's request to flush before the window closes (#44). The
   * renderer flushes, then calls `app:flushDone` with the actual outcome.
   * Returns an unsubscribe fn.
   */
  onFlushBeforeClose: (
    cb: () => boolean | void | Promise<boolean | void>,
  ): (() => void) =>
    forwardPush("app:flushBeforeClose", () => {
      // The renderer flushes its buffer, then signals completion so main can
      // destroy the window. Signal failure even if the callback throws so quit
      // never hangs and main can persist the next-launch warning.
      let flushed = false;
      void Promise.resolve()
        .then(() => cb())
        .then((result) => {
          flushed = result !== false;
        })
        .catch(() => {})
        .finally(() => {
          void ipcRenderer.invoke("app:flushDone", flushed);
        });
    }),
  /**
   * Subscribe to debounced folder-change notifications carrying the changed
   * file's basename (#44). Returns an unsubscribe fn.
   */
  onFolderChanged: (cb: (data: { filename: string }) => void): (() => void) =>
    forwardPush("fs:folderChanged", cb),
});
