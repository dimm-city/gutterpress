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
 */

export type {
  UpdateChannel,
  UpdaterAvailableAction,
  UpdaterStatus,
  UpdaterEventPayload,
  AppSettings,
  LastFlushFailure,
  DeviceCodeInfo,
  RemoteConnection,
  GoogleConnectStartResult,
  GoogleConnectResult,
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
