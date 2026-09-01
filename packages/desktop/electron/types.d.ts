// Electron-side ambient types for the desktop host. `gutterpress` now
// ships real declarations; this file only keeps desktop-specific ambient modules
// and the window bridge augmentation.

// ──────────────────────────────────────────────────────────────────────────
// window.electron — bridge types for the renderer / SvelteKit SPA
//
// Shared IPC payload types (AppSettings, SyncOutcome, etc.) are defined once
// in src/lib/platform/shared-types.ts and re-exported here via bridge-types.ts.
// No more "Keep them in sync manually" — add new shared types to shared-types.ts.
//
// SFE-P5c1 correction: an earlier revision of this run deleted this
// `Window.electron` block as a "zero-consumer duplicate" of preload.ts's own
// typing (SFE-P5b's search found zero RUNTIME reads of `window.electron`
// anywhere under electron/). That search was real but incomplete: this
// block is also a TYPE-graph dependency, not just a runtime one.
// `electron/main.ts` value-imports `../src/lib/persistence-failures.ts`,
// which type-imports `src/lib/platform/contract.ts`, which type-imports
// `EditorProjectionArgs`/`EditorProjectionOutcome` from
// `../editor-host/editor-projection-capability.ts` — a module that
// VALUE-imports `../platform/bridge.ts`, whose `window.electron` reference
// needs SOME ambient `Window.electron` typing to satisfy `tsc -p
// electron/tsconfig.json` (which does not include `src/app.d.ts` — the SPA's
// OWN `Window.electron` ambient declaration lives in a tsconfig program this
// one does not share). Deleting this block broke `bun run typecheck` via
// that pre-existing chain — confirmed by actually running it, not by a
// repeated grep for `window.electron` reads. Restored; kept in agreement
// with `bridge-types.ts` + `contract.ts`'s `ElectronBridge` by hand, same as
// before.
//
// This file is a TS module (has `import type`) so all augmentations live
// inside `declare global { ... }`.
// ──────────────────────────────────────────────────────────────────────────

import type {
  UpdaterEventPayload,
  AppSettings,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  ExportProgressEvent,
  MarkdownFileLaunchEvent,
  PreviewStartResult,
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
} from "./bridge-types";

declare global {
  // UpdaterStatus is re-used by ElectronUpdater below.
  interface UpdaterStatus {
    currentVersion: string | null;
    stagedVersion: string | null;
    availableVersion: string | null;
    availableAction: "download" | "open-release" | null;
    phase: "idle" | "checking" | "available" | "downloading" | "staged" | "error";
    error: string | null;
  }

  type UpdaterEvent = UpdaterEventPayload;

  // getStatus/check/download migrated to server routes (api.updater.*) —
  // ARCH review #8: plain request/response, no push stream or
  // live-BrowserWindow need. applyNow + onEvent stay on the bridge.
  interface ElectronUpdater {
    applyNow(): Promise<{ applied: boolean; version?: string; error?: string }>;
    onEvent(cb: (event: UpdaterEvent) => void): () => void;
  }

  interface Window {
    electron?: {
      /** Integer IPC-surface version exposed by the preload bridge. */
      apiVersion: number;
      updater: ElectronUpdater;

      // ── fs / dialog / shell / log / app — typed IPC (SFE-P5c1) ──────────
      fs: {
        readFile(path: string): Promise<string>;
        writeFile(path: string, content: string): Promise<FileWriteResult>;
        statFile(path: string): Promise<FileStat>;
        listDir(path: string): Promise<DirEntry[]>;
        listProjectFiles(projectDir: string): Promise<ProjectFileEntry>;
        createFile(dir: string, name: string, content: string): Promise<{ path: string; mtimeMs: number }>;
        createFolder(dir: string, name: string): Promise<{ path: string }>;
        renamePath(path: string, newName: string): Promise<{ path: string }>;
        deletePath(path: string, projectDir: string): Promise<{ ok: true }>;
      };
      dialog: {
        openDirectory(): Promise<string | null>;
        savePdf(defaultName?: string): Promise<string | null>;
        pickImageFile(): Promise<string | null>;
        pickPdfFile(): Promise<string | null>;
        pickImageFiles(): Promise<string[]>;
      };
      shell: {
        openExternal(url: string): Promise<{ ok: true }>;
        showInFolder(filePath: string): Promise<{ ok: true }>;
      };
      log: {
        read(logPath: string): Promise<string | null>;
        list(): Promise<LogFileEntry[]>;
      };
      app: {
        getDesktopPrefs(): Promise<DesktopPrefs>;
        setDesktopPrefs(prefs: Record<string, unknown>): Promise<{ ok: true }>;
        getDesktopProjectState(projectDir: string): Promise<ProjectState | null>;
        setDesktopProjectState(projectDir: string, state: Record<string, unknown>): Promise<{ ok: true }>;
        getSettings(): Promise<Record<string, unknown>>;
        setSettings(settings: Record<string, unknown>): Promise<{ ok: true }>;
        getNativeTheme(): Promise<{ shouldUseDarkColors: boolean }>;
        getRecentFolders(): Promise<
          Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>
        >;
        getFavorites(): Promise<Array<{ path: string; title: string; exists: boolean }>>;
        toggleFavorite(path: string, title: string): Promise<{ favorited: boolean }>;
        removeRecent(path: string): Promise<{ ok: true }>;
        discoverProjects(): Promise<DiscoveredProject[]>;
        classifyProject(projectDir: string): Promise<ProjectClassification>;
        createProject(options: Record<string, unknown>): Promise<unknown>;
        adoptFolder(options: Record<string, unknown>): Promise<unknown>;
        setDirtyState(dirty: boolean): Promise<{ ok: true }>;
        recordFlushFailure(projectDir: string | null): Promise<{ failedAt: string; projectDir?: string }>;
        acknowledgeFlushFailure(failedAt: string): Promise<{ acknowledged: boolean }>;
        appImageIntegration: {
          getStatus(): Promise<AppImageStatus>;
          install(): Promise<AppImageInstallResult>;
          remove(): Promise<AppImageRemoveResult>;
        };
      };

      // Native (OS) theme surface (#48) — push channel kept as IPC (main→renderer)
      onNativeThemeUpdated(
        cb: (data: { shouldUseDarkColors: boolean }) => void
      ): () => void;
      onOpenMarkdownFile(cb: (data: MarkdownFileLaunchEvent) => void): () => void;
      // tpl:* and snip:* migrated to server routes (Phase 2D) — removed from ElectronBridge.
      // plugin:*, theme:*, project:listStyles migrated to server routes (Phase 2E) — removed from ElectronBridge.
      // Local version history (#13) — all migrated to SvelteKit server routes (src/routes/api/vcs/*):
      // enableVersionHistory, listSnapshots, listSnapshotsPage, restoreSnapshot, saveSnapshot.
      // Managed GitHub integration (#15)
      connectGitHubStart(): Promise<DeviceCodeInfo>;
      connectGitHubWait(): Promise<RemoteConnection>;
      connectGitHubCancel(): Promise<{ ok: boolean }>;
      // disconnectGitHub, getRemoteConnection, listRemoteRepositories, listRemoteBranches,
      // listRepoBooks — migrated to server routes (Phase 2F).
      // cloneRemoteRepository migrated to server route (api.remote.cloneRepository)
      // — ARCH review #8: plain request/response, no push stream involved itself.
      onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;
      // diagnoseProjectRemote, testRemoteAccess, connectGenericHost, disconnectHost,
      // listHostConnections, forgeTokenUrl — migrated to server routes (Phase 2F).
      // Auto-sync orchestrator seam (transparent sync, §4.4 integration plan)
      /** Subscribe to ambient sync-status push events. Returns an unsubscribe fn.
       *  Note: data may carry a `message` field when state is 'error'. */
      onSyncStatus(cb: (data: unknown) => void): () => void;
      // setAutoSync migrated to server route (api.sync.setAutoSync) — ARCH
      // review #8: a pure settings write, no push stream or live-BrowserWindow
      // need.
      // getConflictPreview — migrated to server route (src/routes/api/sync/get-conflict-preview)
      // syncChanges — migrated to server route (Phase 2F)
      // resolveSyncConflicts migrated to server route (api.remote.resolveSyncConflicts)
      // — ARCH review #8: plain request/response.
      startPreview(args: { input: string }): Promise<PreviewStartResult>;
      stopPreview(): Promise<{ stopped: boolean }>;
      cancelExport(exportId: string): Promise<{ canceled: boolean }>;
      build(args: {
        input: string;
        format: "pdf" | "html" | "pdfx";
        out?: string;
        title?: string;
        pdfxFlavor?: string;
        icc?: string;
        manifest?: string;
        stripAnnotations?: boolean;
        skipLint?: boolean;
        skipPreValidate?: boolean;
        skipPostValidate?: boolean;
      }): Promise<{
        exportId?: string;
        outDir: string;
        htmlPath?: string;
        pdfPath?: string;
        fingerprintPath?: string;
        diagnostics?: Array<{ code: string; severity: "warning" | "info"; message: string }>;
      }>;
      // doctor migrated to server route (Phase 2C)
      // SFE-P3e: host-built, plugin-aware rich-editor projection. Resolves
      // to a discriminated EditorProjectionOutcome, never a `.code`-tagged
      // rejection (review round 2 — see electron/editor-projection.ts).
      buildEditorProjection(args: EditorProjectionHostArgs): Promise<EditorProjectionOutcome>;
      // Event subscriptions
      // M29: ExportProgressEvent used to be hand-duplicated here — it is now
      // the single shared-types.ts type (re-exported via bridge-types.ts),
      // same as every other payload type in this file.
      onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void;
      onUrlPreviewBlocked(cb: (data: { url: string; reason: string }) => void): () => void;
      // writeRecovery, clearRecovery, listRecovery — migrated to server routes
      // (src/routes/api/recovery/*) via globalThis hooks registered in main.ts.
      // app:setDirtyState migrated to typed IPC (SFE-P5c1) — see the `app`
      // member above.
      onFlushBeforeClose(cb: () => boolean | void | Promise<boolean | void>): () => void;
      onFolderChanged(cb: (data: { filename: string }) => void): () => void;
    };
  }
}

// This export makes the file a module (required for `import type` at top-level).
export {};
