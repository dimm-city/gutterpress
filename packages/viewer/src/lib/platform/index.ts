/**
 * Platform abstraction entry point (#41).
 *
 * App code imports `getPlatform()` and the `Platform` type from here — and
 * nothing else touches `window.electron`. Swapping in a real `WebAdapter` for
 * the 0.6.0 PWA is a change to this file alone.
 */
import { ElectronAdapter } from "./electron-adapter";
import { WebAdapter } from "./web-adapter";
import type { Platform } from "./contract";

export { DEFAULT_SETTINGS } from "./contract";

export type {
  Platform,
  PlatformAdapter,
  HostServices,
  ElectronBridge,
  UpdaterApi,
  UpdaterStatus,
  UpdaterEvent,
  UpdaterAvailableAction,
  ViewerPrefs,
  AppSettings,
  DeepPartial,
  FolderRef,
  FileRef,
  PlatformCapabilities,
  PreviewStartArgs,
  PreviewStartResult,
  BuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
  NativeThemeState,
} from "./contract";

export type { RecentFolderEntry, FavoriteEntry, PrintSafeWarning } from "./dtos";

let instance: Platform | null = null;

/** True when running inside the Electron shell (the preload bridge is present). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.electron);
}

/**
 * Return the active platform adapter (memoised). `ElectronAdapter` when the
 * preload bridge is present, otherwise the `WebAdapter` stub.
 */
export function getPlatform(): Platform {
  if (!instance) {
    instance = isDesktop() ? new ElectronAdapter() : new WebAdapter();
  }
  return instance;
}

/** Test-only: reset the memoised adapter. */
export function __resetPlatform(): void {
  instance = null;
}
