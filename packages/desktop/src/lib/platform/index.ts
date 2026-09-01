/**
 * Platform abstraction entry point (#41).
 *
 * App code imports `getPlatform()` and the `Platform` type from here — and
 * nothing else touches `window.electron`.
 *
 * SFE-P5a (D10): the dormant browser host (`WebAdapter`) was deleted — a
 * future web product is a separate package consuming
 * `@dimm-city/gutterpress-editor` and `gutterpress/render`, not a second host
 * hiding inside this one. `getPlatform()` therefore has exactly one real
 * implementation (`ElectronAdapter`); off-Electron it fails loudly with a
 * named error rather than silently degrading into a partial product.
 */
import { ElectronAdapter } from "./electron-adapter";
import type { Platform } from "./contract";

/** Thrown by {@link getPlatform} when no Electron host is present (SFE-P5a). */
export class DesktopHostRequiredError extends Error {
  constructor() {
    super(
      "desktop host required — the browser host was removed in SFE-P5a; " +
        "a future web product is a separate package",
    );
    this.name = "DesktopHostRequiredError";
  }
}

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
  EditorProjectionArgs,
  EditorProjectionResult,
  EditorProjectionPluginError,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
  NativeThemeState,
} from "./contract";

export type { RecentFolderEntry, FavoriteEntry, PrintSafeWarning } from "./dtos";

export type { WorkspaceMode } from "./shared-types";

let instance: Platform | null = null;

/** True when running inside the Electron shell (the preload bridge is present). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.electron);
}

/**
 * Return the active platform adapter (memoised): `ElectronAdapter` when the
 * preload bridge is present. Off-Electron (a plain browser, or `vite dev`
 * with no preload) this throws {@link DesktopHostRequiredError} instead of
 * selecting a partial substitute — fail loudly, not partially (SFE-P5a).
 */
export function getPlatform(): Platform {
  if (!isDesktop()) {
    throw new DesktopHostRequiredError();
  }
  if (!instance) {
    instance = new ElectronAdapter();
  }
  return instance;
}

/** Test-only: reset the memoised adapter. */
export function __resetPlatform(): void {
  instance = null;
}
