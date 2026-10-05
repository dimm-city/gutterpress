/**
 * Platform abstraction entry point (#41).
 *
 * App code imports `getPlatform()` and the `Platform` type from here — and
 * nothing else touches `window.electron`.
 */
import { ElectronAdapter } from "./electron-adapter";
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
  DesktopPrefs,
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

export type { WorkspaceMode } from "./shared-types";

let instance: Platform | null = null;

/** Return the platform adapter (memoised). */
export function getPlatform(): Platform {
  if (!instance) {
    instance = new ElectronAdapter();
  }
  return instance;
}

/** Test-only: reset the memoised adapter. */
export function __resetPlatform(): void {
  instance = null;
}
