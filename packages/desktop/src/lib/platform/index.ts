/**
 * Platform seam entry point (#41, narrowed SFE-P5b).
 *
 * SFE-P5a deleted the dormant browser host (`WebAdapter`). SFE-P5b deleted
 * the service locator itself: `getPlatform()`, `Platform`, `HostServices`,
 * and `ElectronAdapter` are all gone — each capability a component needs is
 * now a plain function imported directly from a feature-owned module (see
 * `./contract.ts`'s header and `docs/plans/source-first-editor/
 * capability-map.md`).
 *
 * What survives here: `isDesktop()` (still re-exported from `./bridge.ts` —
 * ~20 components only ever needed this boolean check, never the deleted
 * locator) and the type/value re-exports below that still have real
 * consumers outside this run's write ownership.
 */
export { isDesktop, DesktopHostRequiredError } from "./bridge";

export { DEFAULT_SETTINGS } from "./contract";

export type {
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
