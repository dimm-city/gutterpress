/**
 * ElectronAdapter — the ONLY module permitted to CALL methods on
 * `window.electron`.
 *
 * Every method delegates 1:1 to the preload bridge or to an `api.*` server
 * route.
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
  FileStat,
  FileWriteResult,
  FolderChangedEvent,
  DeviceCodeInfo,
  RemoteConnection,
  GoogleConnectStartResult,
  GoogleConnectResult,
  CloneProgressEvent,
  CloneRepositoryArgs,
  SyncOutcome,
  SyncStatus,
  MarkdownFileLaunchEvent,
} from "./contract";
import { api } from "$lib/api";

function bridge(): ElectronBridge {
  const b = window.electron;
  if (!b) {
    throw new Error(
      "ElectronAdapter used outside Electron (window.electron is undefined). " +
        "The desktop app's preload script did not load.",
    );
  }
  return b;
}

export class ElectronAdapter implements Platform {
  readFile(path: string): Promise<string> {
    return api.fs.readFile(path);
  }

  writeFile(path: string, content: string): Promise<FileWriteResult> {
    return api.fs.writeFile(path, content);
  }

  statFile(path: string): Promise<FileStat> {
    return api.fs.statFile(path);
  }

  watchFolder(path: string, cb: () => void): () => void {
    return bridge().watchFolder(path, cb);
  }

  // ── HostServices ────────────────────────────────────────────────────────
  // getStatus/check/download (ARCH review #8) go through the server route
  // client (api.updater.*); applyNow and the onEvent push stream stay on the
  // bridge — applyNow flushes the live renderer buffer via `mainWindow.
  // webContents.send` before quitting (a live-BrowserWindow call §8
  // sanctions), and onEvent is a push subscription.
  get updater(): UpdaterApi {
    const b = bridge();
    return {
      getStatus: () => api.updater.getStatus(),
      check: () => api.updater.check(),
      download: () => api.updater.download(),
      applyNow: () => b.updater.applyNow(),
      onEvent: (cb) => b.updater.onEvent(cb),
    };
  }

  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void {
    return bridge().onNativeThemeUpdated(cb);
  }

  onOpenMarkdownFile(cb: (event: MarkdownFileLaunchEvent) => void): () => void {
    return bridge().onOpenMarkdownFile(cb);
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

  // ── Google Drive publish connect (#221) — delegate 1:1 to the bridge ──────
  connectGoogleStart(account?: string): Promise<GoogleConnectStartResult> {
    return bridge().connectGoogleStart(account);
  }

  connectGoogleWait(): Promise<GoogleConnectResult> {
    return bridge().connectGoogleWait();
  }

  connectGoogleCancel(): Promise<{ ok: boolean }> {
    return bridge().connectGoogleCancel();
  }

  // ARCH review #8: was IPC despite being a plain request/response — the
  // clone-progress push (onCloneProgress below) stays on the bridge unchanged.
  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
    return api.remote.cloneRepository(args);
  }

  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void {
    return bridge().onCloneProgress(cb);
  }

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ──
  onSyncStatus(handler: (status: SyncStatus) => void): () => void {
    return bridge().onSyncStatus(handler as (data: unknown) => void);
  }

  // ARCH review #8: was IPC despite being a pure settings write.
  async setAutoSync(enabled: boolean): Promise<void> {
    await api.sync.setAutoSync(enabled);
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

  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void {
    return bridge().onBuildProgress(cb);
  }

  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void {
    return bridge().onUrlPreviewBlocked(cb);
  }

  onFlushBeforeClose(cb: (mode?: "flush" | "discard") => boolean | void | Promise<boolean | void>): () => void {
    return bridge().onFlushBeforeClose(cb);
  }

  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void {
    return bridge().onFolderChanged(cb);
  }
}
