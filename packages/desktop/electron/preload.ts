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
 */
const DESKTOP_API = 5;

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

// plugin:*, theme:*, project:listStyles types removed — migrated to server
// routes (Phase 2E). This block used to also declare module-local
// `StyleToken`/`RecentFolderEntry`/`FavoriteEntry`/`DiscoveredProject`
// interfaces left behind by that migration and never referenced anywhere in
// this file — the real shapes live in src/lib/platform/dtos.ts. Removed in
// the 2026-07-28 duplication audit; see
// docs/reviews/duplication-audit-2026-07-28.md.

// Local version history (#13): `SnapshotEntry` / `RestoreVersionResult` /
// `ProjectClassification` are defined in `src/lib/platform/shared-types.ts`
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

  // Dialogs
  // savePdf, pickImageFile, pickImageFiles, copyFile migrated to server routes
  // openDirectory migrated to server route (api.dialog.openDirectory)
  // openExternal, showInFolder, readLogFile migrated to server routes
  // listProjectImages, imageThumbnail, inspectImage migrated to server routes (Phase 2C)

  // Filesystem primitives migrated to SvelteKit server routes (api.fs.*)
  // readFile, writeFile, listDir, statFile migrated to server routes
  // listProjectFiles migrated to server route
  // checkCss, lintProject migrated to server routes (Phase 2C)
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
  // app:getLastProject, app:getDesktopPrefs,
  // app:setDesktopPrefs, app:getDesktopProjectState, app:setDesktopProjectState,
  // app:getSettings, app:setSettings, app:getNativeTheme, app:getRecentFolders,
  // app:getFavorites, app:toggleFavorite, app:removeRecent, app:discoverProjects,
  // app:classifyProject, app:createProject, app:adoptFolder
  // — migrated to SvelteKit server routes (Phase 2B). No IPC bridge needed.

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

  // tpl:* and snip:* migrated to server routes (Phase 2D) — removed from contextBridge.

  // plugin:*, theme:*, project:listStyles migrated to server routes (Phase 2E) — removed from contextBridge.

  // Local version history (#13) — all migrated to SvelteKit server routes (src/routes/api/vcs/*):
  // enableVersionHistory, listSnapshots, listSnapshotsPage, restoreSnapshot, saveSnapshot.

  // ── Managed GitHub integration (#15) — device flow + repo picker + clone ──
  // Two-phase connect: Start returns the user code to display; Wait resolves
  // when the user approves in the browser. Tokens never cross this bridge.
  connectGitHubStart: (): Promise<DeviceCodeInfo> =>
    ipcRenderer.invoke("remote:connectGitHubStart"),
  connectGitHubWait: (): Promise<RemoteConnection> =>
    ipcRenderer.invoke("remote:connectGitHubWait"),
  connectGitHubCancel: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("remote:connectGitHubCancel"),
  // disconnectGitHub, getRemoteConnection, listRemoteRepositories, listRemoteBranches,
  // listRepoBooks — migrated to server routes (Phase 2F).
  // cloneRemoteRepository migrated to server route (api.remote.cloneRepository)
  // — ARCH review #8: plain request/response, no push stream involved itself.
  /** Subscribe to clone progress from main. Returns an unsubscribe fn. */
  onCloneProgress: (cb: (data: CloneProgressEvent) => void): (() => void) =>
    forwardPush("remote:cloneProgress", cb),

  // diagnoseProjectRemote, testRemoteAccess, connectGenericHost, disconnectHost,
  // listHostConnections, forgeTokenUrl — migrated to server routes (Phase 2F).

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ─
  // Main emits `sync:status` push events whenever the orchestrator state machine
  // transitions. The renderer subscribes via onSyncStatus to drive the ambient
  // pill without polling. setAutoSync migrated to server route
  // (api.sync.setAutoSync) — ARCH review #8: a pure settings write, no push
  // stream or live-BrowserWindow need.

  /** Subscribe to ambient sync-status push events. Returns an unsubscribe fn. */
  onSyncStatus: (cb: (data: unknown) => void): (() => void) =>
    forwardPush("sync:status", cb),

  // getConflictPreview — migrated to server route (src/routes/api/sync/get-conflict-preview)

  // syncChanges — migrated to server route (Phase 2F).
  // resolveSyncConflicts migrated to server route (api.remote.resolveSyncConflicts)
  // — ARCH review #8: plain request/response.

  startPreview: (args: RawPreviewStartArgs): Promise<PreviewStartResult> =>
    ipcRenderer.invoke("api:preview", args),
  stopPreview: (): Promise<{ stopped: boolean }> =>
    ipcRenderer.invoke("api:stopPreview"),
  cancelExport: (exportId: string): Promise<{ canceled: boolean }> =>
    ipcRenderer.invoke("api:cancelExport", exportId),
  build: (args: RawBuildArgs): Promise<BuildResult> =>
    ipcRenderer.invoke("api:build", args),
  // doctor migrated to server route (Phase 2C)

  // Live PDF-build progress (main → renderer). Returns an unsubscribe fn.
  onBuildProgress: (
    cb: (data: ExportProgressEvent) => void
  ): (() => void) => forwardPush("build:progress", cb),

  onUrlPreviewBlocked: (
    cb: (data: UrlPreviewBlockedEvent) => void
  ): (() => void) => forwardPush("url-preview:blocked", cb),

  // writeRecovery, clearRecovery, listRecovery — migrated to server routes
  // (src/routes/api/recovery/*) via globalThis hooks registered in main.ts.

  // app:setDirtyState — migrated to server route (Phase 2B).
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
