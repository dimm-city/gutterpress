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
 *   - Import ONLY with `import type` — zero runtime coupling.
 */

export type {
  UpdaterStatus,
  UpdaterEventPayload,
  ProjectSource,
  ProjectCapabilities,
  AppSettings,
  DeepPartial,
  DeepPartialSettings,
  ProjectState,
  ViewerPrefs,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConflictKind,
  ConflictFileInfo,
  ConflictResolutionChoice,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  RawPreviewStartArgs,
  PreviewStartResult,
  RawBuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
} from "../src/lib/platform/shared-types";
