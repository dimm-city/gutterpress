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
import { DEFAULT_SETTINGS } from "./contract";
import type {
  Platform,
  ViewerPrefs,
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
  UpdaterStatus,
  NativeThemeState,
  DiscoveredProject,
  ProjectClassification,
} from "./contract";

const NOT_IMPL = "Web platform support lands in 0.6.0 (#41).";

function notImplemented(method: string): never {
  throw new Error(`${method}: ${NOT_IMPL}`);
}

function rejectNotImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`${method}: ${NOT_IMPL}`));
}

const SETTINGS_KEY = "print-md.app-settings";

/** Recursively merge a settings patch over a base, returning a new object. */
function deepMergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = { ...base[key], ...(value as object) };
    }
  }
  return out as unknown as AppSettings;
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

  // Settings (#45) — genuinely implemented on web via localStorage so the
  // settings store works even outside Electron.
  getSettings(): Promise<AppSettings> {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      const stored = raw ? (JSON.parse(raw) as DeepPartial<AppSettings>) : {};
      return Promise.resolve(deepMergeSettings(DEFAULT_SETTINGS, stored));
    } catch {
      return Promise.resolve(DEFAULT_SETTINGS);
    }
  }

  setSettings(patch: DeepPartial<AppSettings>): Promise<{ ok: boolean }> {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      const stored = raw ? (JSON.parse(raw) as DeepPartial<AppSettings>) : {};
      const merged = deepMergeSettings(deepMergeSettings(DEFAULT_SETTINGS, stored), patch);
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(merged));
      return Promise.resolve({ ok: true });
    } catch {
      return Promise.resolve({ ok: false });
    }
  }

  // Native (OS) theme (#48) — genuinely implemented via matchMedia so the
  // PWA / `vite dev` path themes correctly (not a 0.6.0 stub).
  getNativeTheme(): Promise<NativeThemeState> {
    const dark =
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
    return Promise.resolve({ shouldUseDarkColors: dark });
  }

  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void {
    if (typeof globalThis.matchMedia !== "function") return () => {};
    const mql = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) =>
      cb({ shouldUseDarkColors: e.matches });
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
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

  // Project discovery (#27) — no background filesystem scan on the PWA (File
  // System Access API restrictions). Resolve to [] so the Discovered section is
  // simply absent rather than erroring.
  discoverProjects(): Promise<DiscoveredProject[]> {
    return Promise.resolve([]);
  }

  classifyProject(_path: string): Promise<ProjectClassification> {
    return rejectNotImplemented("classifyProject");
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
