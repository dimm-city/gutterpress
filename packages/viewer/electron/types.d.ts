// Electron-side ambient types for the viewer host. `@dimm-city/print-md` now
// ships real declarations; this file only keeps viewer-specific ambient modules
// and the window bridge augmentation.

// `?raw` imports (electron-vite/vite) return the file contents as a string. Used
// for the splash markup, which is baked into the main bundle.
declare module "*.html?raw" {
  const content: string;
  export default content;
}

// ──────────────────────────────────────────────────────────────────────────
// window.electron — bridge types for the renderer / SvelteKit SPA
//
// Shared IPC payload types (AppSettings, SyncOutcome, etc.) are defined once
// in src/lib/platform/shared-types.ts and re-exported here via bridge-types.ts.
// No more "Keep them in sync manually" — add new shared types to shared-types.ts.
//
// This file is a TS module (has `import type`) so all augmentations live
// inside `declare global { ... }`. main.ts imports SnapshotEntry / SnapshotPage
// / RestoreVersionResult directly from ./bridge-types (no longer ambient).
// ──────────────────────────────────────────────────────────────────────────

import type {
  UpdaterEventPayload,
  AppSettings,
  ProjectSource,
  ProjectCapabilities,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  ConflictFileInfo,
} from "./bridge-types";

declare global {
  // UpdaterStatus is re-used by ElectronUpdater below.
  interface UpdaterStatus {
    currentVersion: string | null;
    stagedVersion: string | null;
    availableVersion: string | null;
    phase: "idle" | "checking" | "available" | "downloading" | "staged" | "error";
    error: string | null;
  }

  type UpdaterEvent = UpdaterEventPayload;

  // getStatus/check/download migrated to server routes (api.updater.*) —
  // ARCH review #8: plain request/response, no push stream or
  // live-BrowserWindow need. applyNow + onEvent stay on the bridge.
  interface ElectronUpdater {
    applyNow(): Promise<{ applied: boolean; version?: string }>;
    onEvent(cb: (event: UpdaterEvent) => void): () => void;
  }

  // plugin:*, theme:*, project:listStyles types removed — migrated to server routes (Phase 2E).
  interface StyleToken {
    name: string;
    value: string;
    kind: "color" | "length" | "text";
    label: string;
    number?: number;
    unit?: string;
  }

  /** Result of classifying an opened folder (#12). */
  interface ProjectClassification {
    source: ProjectSource;
    capabilities: ProjectCapabilities;
  }

  // ── Sync recovery seam (Foundation — §8 / ADR 0004) ──────────────────────
  // Defined locally so the renderer never value-imports the lib.

  interface RecoveryConfirmRequest {
    requestId: string;
    projectDir: string;
    confirmation: {
      repair: string;
      risk: "none" | "low" | "medium" | "high";
      summary: string;
      backupZipPath: string;
      willChangeLocalFiles: boolean;
      willChangeGitMetadata: boolean;
      willChangeRemote: boolean;
      canBeUndoneFromBackup: boolean;
    };
  }

  interface ConflictPreview {
    mine: string;
    theirs: string;
    kind: "both-edited" | "you-deleted" | "online-deleted";
    isBinary: boolean;
  }

  interface Window {
    electron?: {
      /** Integer IPC-surface version exposed by the preload bridge. */
      apiVersion: number;
      updater: ElectronUpdater;
      // Dialogs
      // savePdf, pickImageFile, pickImageFiles, copyFile migrated to server routes
      // openDirectory migrated to server route (api.dialog.openDirectory)
      // openExternal, showInFolder, readLogFile migrated to server routes
      // listProjectImages, imageThumbnail, inspectImage migrated to server routes (Phase 2C)
      // listProjectFiles migrated to server route
      // Filesystem primitives migrated to server routes (api.fs.*)
      // readFile, writeFile, listDir, statFile migrated to server routes
      // checkCss, lintProject migrated to server routes (Phase 2C)
      // File metadata + folder watch (PlatformAdapter, #44)
      watchFolder(dirPath: string, cb: () => void): () => void;
      // getStatus, doctor migrated to server routes (Phase 2C)
      // app:getLastProject, app:splashStatus, app:rendererReady, app:getViewerPrefs,
      // app:setViewerPrefs, app:getViewerProjectState, app:setViewerProjectState,
      // app:getSettings, app:setSettings, app:getNativeTheme, app:getRecentFolders,
      // app:getFavorites, app:toggleFavorite, app:removeRecent, app:discoverProjects,
      // app:classifyProject, app:createProject, app:adoptFolder
      // — migrated to SvelteKit server routes (Phase 2B).
      // Native (OS) theme surface (#48) — push channel kept as IPC (main→renderer)
      onNativeThemeUpdated(
        cb: (data: { shouldUseDarkColors: boolean }) => void
      ): () => void;
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
       *  Note: data may carry `recovery`, `guidance`, and `backupZipPath` fields
       *  when state is 'recovering', 'recovered', or 'error' (classified failure). */
      onSyncStatus(cb: (data: unknown) => void): () => void;
      // setAutoSync migrated to server route (api.sync.setAutoSync) — ARCH
      // review #8: a pure settings write, no push stream or live-BrowserWindow
      // need.
      // Sync recovery seam (Foundation — §8 / ADR 0004)
      /** Subscribe to risky-repair confirm requests from main. Returns unsubscribe fn. */
      onRecoveryConfirm(cb: (data: unknown) => void): () => void;
      /** Send the author's approval/rejection to main to unblock a pending repair. */
      respondRecoveryConfirm(requestId: string, approved: boolean): Promise<void>;
      // getConflictPreview — migrated to server route (src/routes/api/sync/get-conflict-preview)
      // syncChanges — migrated to server route (Phase 2F)
      // resolveSyncConflicts migrated to server route (api.remote.resolveSyncConflicts)
      // — ARCH review #8: plain request/response.
      startPreview(args: { input: string }): Promise<{
        url: string;
        port: number;
        input: string;
        title: string | null;
        missingSharedAssets?: string[];
      }>;
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
      }>;
      // doctor migrated to server route (Phase 2C)
      // Event subscriptions
      onBuildProgress(cb: (data: {
        exportId: string;
        state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
        pages?: number;
        message?: string;
      }) => void): () => void;
      onUrlPreviewBlocked(cb: (data: { url: string; reason: string }) => void): () => void;
      // writeRecovery, clearRecovery, listRecovery — migrated to server routes
      // (src/routes/api/recovery/*) via globalThis hooks registered in main.ts.
      // app:setDirtyState — migrated to server route (Phase 2B).
      onFlushBeforeClose(cb: () => void): () => void;
      onFolderChanged(cb: (data: { filename: string }) => void): () => void;
    };
  }
}

// This export makes the file a module (required for `import type` at top-level).
export {};
