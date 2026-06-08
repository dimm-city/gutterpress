/**
 * WebAdapter — stub for the future PWA host (#41 acceptance: "ready for 0.6.0,
 * throws 'not implemented' for file watch").
 *
 * The viewer ships Electron-only in 0.4.0; this adapter is selected only when
 * the app runs in a plain browser (e.g. `vite dev` with no preload). To match
 * today's behaviour in that context — where `window.electron` is undefined and
 * the app's capability guards short-circuit — host-service methods return
 * REJECTED promises (so existing `.catch()` fire-and-forget calls stay silent)
 * and subscription methods return a no-op unsubscribe. The genuinely
 * host-divergent primitives throw, to be implemented via the File System Access
 * API in 0.6.0.
 */
import type {
  Platform,
  ViewerPrefs,
  PreviewStartArgs,
  PreviewStartResult,
  BuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  RecentFolderEntry,
  FavoriteEntry,
  UpdaterApi,
  UpdaterStatus,
} from "./contract";

const NOT_IMPL = "Web platform support lands in 0.6.0 (#41).";

function notImplemented(method: string): never {
  throw new Error(`${method}: ${NOT_IMPL}`);
}

function rejectNotImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`${method}: ${NOT_IMPL}`));
}

const webUpdater: UpdaterApi = {
  getStatus: () =>
    rejectNotImplemented("updater.getStatus") as Promise<UpdaterStatus>,
  check: () => rejectNotImplemented("updater.check") as Promise<UpdaterStatus>,
  applyNow: () => rejectNotImplemented("updater.applyNow"),
  markReady: () => rejectNotImplemented("updater.markReady"),
  onEvent: () => () => {},
};

export class WebAdapter implements Platform {
  readonly platform = "web" as const;
  readonly apiVersion = 0;
  readonly updater = webUpdater;

  // ── PlatformAdapter primitives — implemented in 0.6.0 ─────────────────────
  openFolder(): Promise<string | null> {
    return notImplemented("openFolder");
  }

  readFile(_path: string): Promise<string> {
    return notImplemented("readFile");
  }

  writeFile(_path: string, _content: string): Promise<void> {
    return notImplemented("writeFile");
  }

  watchFolder(_path: string, _cb: () => void): () => void {
    return notImplemented("watchFolder");
  }

  getSecret(_key: string): Promise<string | null> {
    return notImplemented("getSecret");
  }

  setSecret(_key: string, _value: string): Promise<void> {
    return notImplemented("setSecret");
  }

  // ── HostServices — reject so existing `.catch()` guards stay silent ───────
  savePdf(_defaultName?: string): Promise<string | null> {
    return rejectNotImplemented("savePdf");
  }

  openExternal(_url: string): Promise<void> {
    return rejectNotImplemented("openExternal");
  }

  showInFolder(_filePath: string): Promise<void> {
    return rejectNotImplemented("showInFolder");
  }

  getStatus(): Promise<{ ok: boolean; runtime: string; name: string }> {
    return rejectNotImplemented("getStatus");
  }

  getLastProject(): Promise<string | null> {
    return rejectNotImplemented("getLastProject");
  }

  getViewerPrefs(): Promise<ViewerPrefs> {
    return rejectNotImplemented("getViewerPrefs");
  }

  setViewerPrefs(_patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> {
    return rejectNotImplemented("setViewerPrefs");
  }

  getRecentFolders(): Promise<RecentFolderEntry[]> {
    return rejectNotImplemented("getRecentFolders");
  }

  getFavorites(): Promise<FavoriteEntry[]> {
    return rejectNotImplemented("getFavorites");
  }

  toggleFavorite(_folderPath: string, _title: string): Promise<{ favorited: boolean }> {
    return rejectNotImplemented("toggleFavorite");
  }

  removeRecent(_folderPath: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("removeRecent");
  }

  startPreview(_args: PreviewStartArgs): Promise<PreviewStartResult> {
    return rejectNotImplemented("startPreview");
  }

  stopPreview(): Promise<{ stopped: boolean }> {
    return rejectNotImplemented("stopPreview");
  }

  cancelExport(_exportId: string): Promise<{ canceled: boolean }> {
    return rejectNotImplemented("cancelExport");
  }

  build(_args: BuildArgs): Promise<BuildResult> {
    return rejectNotImplemented("build");
  }

  doctor(): Promise<unknown> {
    return rejectNotImplemented("doctor");
  }

  onBuildProgress(_cb: (data: ExportProgressEvent) => void): () => void {
    return () => {};
  }

  onUrlPreviewBlocked(_cb: (data: UrlPreviewBlockedEvent) => void): () => void {
    return () => {};
  }
}
