import { contextBridge, ipcRenderer } from "electron";
import type {
  UpdaterEventPayload,
  DeviceCodeInfo,
  RemoteConnection,
  GoogleConnectStartResult,
  GoogleConnectResult,
  CloneProgressEvent,
  RawPreviewStartArgs,
  PreviewStartResult,
  RawBuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
} from "../src/lib/platform/shared-types";

/**
 * Bridge exposed to the SvelteKit renderer as window.electron.
 * Renderer never imports node:* or electron itself — all native work
 * happens here, in the preload, or in main via ipcRenderer.invoke.
 *
 * The bridge is deliberately narrow (CLAUDE.md §8): it carries only the
 * main→renderer push streams and the calls that need a live BrowserWindow.
 * Everything else is a `src/routes/api/**` server route. Shared payload
 * types live in src/lib/platform/shared-types.ts.
 */

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
  // Desktop update surface (electron-updater + macOS check-only notifier).
  // applyNow stays IPC: it flushes the live renderer's unsaved buffer via
  // `mainWindow.webContents.send` before quitting — a live-BrowserWindow
  // call §8 sanctions. getStatus/check/download are server routes.
  // ──────────────────────────────────────────────────────────────────────
  updater: {
    applyNow: (): Promise<{ applied: boolean; version?: string; error?: string }> =>
      ipcRenderer.invoke("updater:applyNow"),
    /** Subscribe to updater events from main. Returns an unsubscribe fn. */
    onEvent: (cb: (data: UpdaterEventPayload) => void): (() => void) =>
      forwardPush("updater:event", cb),
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

  // Native (OS) theme surface (#48) — push channel (main→renderer)
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

  // ── Managed GitHub integration (#15) — device flow ───────────────────────
  // Two-phase connect: Start returns the user code to display; Wait resolves
  // when the user approves in the browser. Tokens never cross this bridge.
  connectGitHubStart: (): Promise<DeviceCodeInfo> =>
    ipcRenderer.invoke("remote:connectGitHubStart"),
  connectGitHubWait: (): Promise<RemoteConnection> =>
    ipcRenderer.invoke("remote:connectGitHubWait"),
  connectGitHubCancel: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("remote:connectGitHubCancel"),

  // ── Google Drive publish connect (#221) — same two-phase shape, no user
  // code to display (Start resolves with the auth URL instead; Wait resolves
  // when the user approves in the browser). Tokens never cross this bridge.
  connectGoogleStart: (account?: string): Promise<GoogleConnectStartResult> =>
    ipcRenderer.invoke("publish:connectGoogleStart", account),
  connectGoogleWait: (): Promise<GoogleConnectResult> =>
    ipcRenderer.invoke("publish:connectGoogleWait"),
  connectGoogleCancel: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("publish:connectGoogleCancel"),

  /** Subscribe to clone progress from main. Returns an unsubscribe fn. */
  onCloneProgress: (cb: (data: CloneProgressEvent) => void): (() => void) =>
    forwardPush("remote:cloneProgress", cb),

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ─
  // Main emits `sync:status` push events whenever the orchestrator state machine
  // transitions. The renderer subscribes via onSyncStatus to drive the ambient
  // pill without polling.
  /** Subscribe to ambient sync-status push events. Returns an unsubscribe fn. */
  onSyncStatus: (cb: (data: unknown) => void): (() => void) =>
    forwardPush("sync:status", cb),

  startPreview: (args: RawPreviewStartArgs): Promise<PreviewStartResult> =>
    ipcRenderer.invoke("api:preview", args),
  stopPreview: (): Promise<{ stopped: boolean }> =>
    ipcRenderer.invoke("api:stopPreview"),
  cancelExport: (exportId: string): Promise<{ canceled: boolean }> =>
    ipcRenderer.invoke("api:cancelExport", exportId),
  build: (args: RawBuildArgs): Promise<BuildResult> =>
    ipcRenderer.invoke("api:build", args),

  // Live PDF-build progress (main → renderer). Returns an unsubscribe fn.
  onBuildProgress: (
    cb: (data: ExportProgressEvent) => void
  ): (() => void) => forwardPush("build:progress", cb),

  onUrlPreviewBlocked: (
    cb: (data: UrlPreviewBlockedEvent) => void
  ): (() => void) => forwardPush("url-preview:blocked", cb),

  /**
   * Subscribe to main's request to flush before the window closes (#44). The
   * renderer flushes, then calls `app:flushDone` with the actual outcome.
   * Returns an unsubscribe fn.
   */
  onFlushBeforeClose: (
    cb: (mode?: "flush" | "discard") => boolean | void | Promise<boolean | void>,
  ): (() => void) =>
    // `mode` is "discard" when the author chose Don't Save in main's close
    // prompt; anything else means flush.
    forwardPush<"flush" | "discard" | undefined>("app:flushBeforeClose", (mode) => {
      // The renderer flushes its buffer, then signals completion so main can
      // destroy the window. Signal failure even if the callback throws so quit
      // never hangs and main can persist the next-launch warning.
      let flushed = false;
      void Promise.resolve()
        .then(() => cb(mode === "discard" ? "discard" : "flush"))
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
   * file's path relative to the watched folder (#44). Returns an unsubscribe fn.
   */
  onFolderChanged: (cb: (data: { filename: string }) => void): (() => void) =>
    forwardPush("fs:folderChanged", cb),
});
