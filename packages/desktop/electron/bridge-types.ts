/**
 * Electron-side bridge type re-exports.
 *
 * Single source of truth for every payload type that crosses the
 * contextBridge. `preload.ts` and `types.d.ts` import from here instead of
 * redeclaring types. The canonical type definitions live in
 * `src/lib/platform/shared-types.ts`; this file re-exports them so the
 * electron tsconfig (which only includes `electron/**`) can reach them via
 * a single local import.
 *
 * RULES:
 *   - Re-export ONLY (no inline type bodies here).
 *   - `import type` / `export type` for everything EXCEPT the one shared
 *     VALUE below (`DEFAULT_SETTINGS`) — a plain, side-effect-free data
 *     literal (§8-safe), re-exported as a real value so
 *     `electron/settings-store.ts` doesn't hand-duplicate it (#29).
 *
 * CAVEAT (SFE-P3e, mirrors `shared-types.ts`'s own documented
 * `ProjectSource`/`ProjectCapabilities` caveat): `EditorProjectionHostArgs`/
 * `EditorProjectionHostResult`/`EditorProjectionPluginError`/
 * `EditorProjectionOutcome` are re-exported from `./editor-projection`
 * below, NOT from `shared-types.ts` — that file's own rule is "no imports,
 * ever" / "self-contained", but the projection result wraps
 * `gutterpress/render`'s own `GutterpressProjection`, a D6 lib-owned shape
 * this file must not hand-mirror (a manual copy would drift from the real
 * render pipeline). `editor-projection.ts` lives inside `electron/`, so
 * this is a same-directory re-export, not a new package boundary crossing.
 * `EditorProjectionOutcome` (SFE-P3e review round 2) is the bridge's actual
 * `buildEditorProjection` RESULT type — a resolved discriminated union, not
 * a rejection, since Electron's IPC boundary strips a rejected handler's
 * custom Error properties (see `editor-projection.ts`'s own header,
 * "IPC-boundary classification"). `EditorProjectionHostResult` stays
 * re-exported too: it is still `buildHostEditorProjection`'s own success
 * type and `EditorProjectionOutcome`'s `ok: true` member is built from it.
 */

export type {
  EditorProjectionHostArgs,
  EditorProjectionHostResult,
  EditorProjectionPluginError,
  EditorProjectionOutcome,
} from "./editor-projection";

export type {
  UpdateChannel,
  UpdaterAvailableAction,
  UpdaterStatus,
  UpdaterEventPayload,
  AppSettings,
  DesktopPrefs,
  ProjectState,
  LastFlushFailure,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  SyncOutcome,
  KeptBothFile,
  RawPreviewStartArgs,
  PreviewStartResult,
  RawBuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
} from "../src/lib/platform/shared-types";

// VALUE re-export (see file header) — the canonical settings defaults (#29).
export { DEFAULT_SETTINGS } from "../src/lib/platform/shared-types";

// SFE-P5c1: fs/dialog/shell/log/app IPC payload types. `DiscoveredProject`/
// `ProjectClassification` are DTOs (not IPC-shared-types.ts leaf types — that
// file is deliberately import-free) but the relative-import-into-src/lib
// pattern is the same one already used above for shared-types.ts.
export type { DiscoveredProject, ProjectClassification } from "../src/lib/platform/dtos";

// AppImage status/result shapes are electron-side-owned (electron/
// appimage-integration.ts is the real implementation main.ts already
// constructs `AppImageHooks` from) — re-exported here so preload.ts's
// contextBridge typing doesn't hand-duplicate them.
export type {
  AppImageStatus,
  AppImageInstallResult,
  AppImageRemoveResult,
} from "./appimage-integration";

// fs/dialog/log request-response DTOs — small shapes owned by their
// electron/api/*.ts module (same-directory re-export, same rationale as
// editor-projection.ts above).
export type { DirEntry, FileStat, FileWriteResult, ProjectFileEntry } from "./api/fs";
export type { LogFileEntry } from "./api/log";
