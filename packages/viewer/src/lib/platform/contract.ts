/**
 * Viewer-facing platform contract (#41, ARCH review #39).
 *
 * `PlatformAdapter` (the narrow, genuinely host-divergent primitive surface) is
 * the canonical contract and lives in `@dimm-city/print-md`. The viewer adds
 * `HostServices` — the host RPC surface (preview/build/doctor/prefs/updater/
 * dialogs) that is *also* host-divergent (Electron IPC today, HTTP in a future
 * PWA) but is viewer-specific, so it is defined here rather than in the lib.
 *
 * The app consumes `Platform` = `PlatformAdapter & HostServices` via
 * `getPlatform()`. It must NOT touch `window.electron` directly — that access
 * is confined to `electron-adapter.ts`.
 *
 * This file is the SEAM-INTERFACE file: `HostServices`, `ElectronBridge`,
 * `Platform`, and the small cluster of types those interfaces' members
 * reference directly (`UpdaterApi`, `FolderRef`/`FileRef`, `PreviewStartArgs`/
 * `BuildArgs`, `PlatformCapabilities`, `NativeThemeState`,
 * `FolderChangedEvent`, and the sync/recovery status vocabulary —
 * `SyncStatus`/`SyncState`/`RecoveryConfirmRequest`/`ManualGuidanceInfo`/
 * `RepairConfirmationInfo`/`RecoveryProgressInfo`/`RecoveryActionKey`/
 * `ConflictFileEntry`). Plain request/response DTOs that the seam does NOT
 * reference — the ~30 shapes server routes return (plugin manager, theme
 * manager, style resolver, media panel, problems panel, project
 * classification, …) — live in `./dtos.ts`. IPC payload types shared with the
 * Electron host process (and mirrored into `electron/bridge-types.ts`) live in
 * `./shared-types.ts`. This file re-exports both so existing `$lib/platform/
 * contract` importers keep resolving; new code should import DTOs from
 * `./dtos` directly.
 */
import type {
  PlatformAdapter,
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
  CreateProjectOptions,
  AdoptFolderOptions,
  CreateProjectResult,
} from "@dimm-city/print-md";

// Shared IPC payload types — imported from the single source of truth.
// Both electron/bridge-types.ts and this file reference shared-types.ts,
// so these types cannot drift between the host and renderer sides.
import type {
  UpdaterStatus,
  UpdaterEventPayload,
  UpdaterAvailableAction,
  AppSettings,
  DeepPartial,
  ProjectState,
  ViewerPrefs as SharedViewerPrefs,
  LeftPanelPrefs,
  LastFlushFailure,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  RemoteAccessResult,
  ProjectRemoteDiagnosis as SharedProjectRemoteDiagnosis,
  ConflictKind,
  ConflictFileInfo,
  ConflictResolutionChoice,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishIssue,
  PublishOutcomeInfo,
  PublishRunResult,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  PreviewStartResult,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
} from "./shared-types";

export type {
  PlatformAdapter,
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
  CreateProjectOptions,
  AdoptFolderOptions,
  CreateProjectResult,
};

// Re-export the shared IPC payload types for consumers of contract.ts.
export type {
  UpdaterStatus,
  UpdaterEventPayload,
  UpdaterAvailableAction,
  AppSettings,
  DeepPartial,
  ProjectState,
  LastFlushFailure,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  RemoteAccessResult,
  ConflictKind,
  ConflictFileInfo,
  ConflictResolutionChoice,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishIssue,
  PublishOutcomeInfo,
  PublishRunResult,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  PreviewStartResult,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  MarkdownFileLaunchEvent,
};

/**
 * Payload of an `onFolderChanged` event (#44) — the changed entry's basename.
 * Defined here (not `./dtos`) because `HostServices.onFolderChanged`
 * references it directly. Other DTOs — e.g. `ProjectClassification` — live
 * only in `./dtos`; import from there directly.
 */
export interface FolderChangedEvent {
  filename: string;
}

// ── Host RPC payload shapes ────────────────────────────────────────────────
//
// UpdaterStatus and UpdaterEventPayload are imported from shared-types above
// (exported at the top of this file). UpdaterEvent is an alias for the same type.

/** Alias so existing code referencing UpdaterEvent continues to compile. */
export type UpdaterEvent = UpdaterEventPayload;

export interface UpdaterApi {
  getStatus(): Promise<UpdaterStatus>;
  check(): Promise<UpdaterStatus>;
  /** Download the update, or open its release page for check-only hosts. */
  download(): Promise<UpdaterStatus>;
  /** Quit and install the downloaded update (restart). */
  applyNow(): Promise<{ applied: boolean; version?: string; error?: string }>;
  onEvent(cb: (event: UpdaterEvent) => void): () => void;
}

/**
 * A host-neutral reference to a project folder (#49).
 *
 * The app-facing contract deals in `FolderRef`, never raw path strings, so the
 * UI makes no assumptions about path-string semantics. On Electron the `key` is
 * the folder's absolute path; on a future PWA (File System Access API) it will
 * be a serialized FSA handle id. The `displayName` is precomputed by the adapter
 * (the folder basename) so the UI never has to split a path itself.
 */
export interface FolderRef {
  /** Stable key for equality / dedup / persistence. Electron: absolute path. PWA: serialized FSA handle id. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}

/**
 * A host-neutral reference to a FILE (#61), analogous to {@link FolderRef}.
 *
 * The app-facing contract returns a `FileRef` from the native file picker
 * instead of a raw path string, so the UI makes no assumptions about path-string
 * semantics. On Electron the `key` is the file's absolute path; on a future PWA
 * (File System Access API) it will be a serialized FSA file-handle id. The
 * `displayName` is precomputed by the adapter (the file basename) so the UI never
 * has to split a path itself.
 */
export interface FileRef {
  /** Stable key for IPC / persistence. Electron: absolute path. PWA: serialized FSA handle id. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}

// ProjectState and ViewerPrefs are imported from shared-types above
// (re-exported at the top of this file). ViewerPrefs.leftPanel is typed as
// LeftPanelPrefs — both defined in shared-types.ts and re-exported here.

export type { SharedViewerPrefs as ViewerPrefs, LeftPanelPrefs };

// ── Managed GitHub integration (#15, ADR 0006) ────────────────────────────────
//
// DeviceCodeInfo, RemoteConnection, RemoteRepository, RemoteBranch, RepoBook,
// CloneProgressEvent, CloneRepositoryArgs imported from shared-types above
// (re-exported at the top of this file).

// ── Advanced Setup (#14, ADR 0006 D3/D7) ──────────────────────────────────────
//
// RemoteAccessResult and ProjectRemoteDiagnosis imported from shared-types above
// (re-exported at the top of this file). Refined ForgeKind / RemoteGuidanceId
// named aliases live in ./dtos (not part of the seam).

/** Environment status for the Advanced Setup panel — re-exported from shared-types. */
export type { SharedProjectRemoteDiagnosis as ProjectRemoteDiagnosis };

// ── Auto-sync orchestrator status (transparent sync, §4.4 integration plan) ──
//
// Defined locally here — decoupled from the lib — so the SPA never
// value-imports the lib (§8 / ADR 0004). Main emits `sync:status` events with
// this payload; the renderer drives the ambient status pill from it. Kept
// alongside HostServices (rather than in ./dtos) because `onSyncStatus` and
// `onRecoveryConfirm` reference this cluster directly.

/**
 * Ambient sync state emitted by the host auto-sync orchestrator and surfaced
 * to the renderer via the `onSyncStatus` subscription.
 *
 * States:
 *   idle        — no sync scheduled or needed (local-only project, or auto-sync OFF)
 *   syncing     — commit→fetch→merge→push in flight ("Saving changes…")
 *   synced      — last sync completed and remote is up to date
 *   up-to-date  — sync ran; nothing needed (no local or remote changes)
 *   offline     — network unavailable; changes are saved locally
 *   auth        — credential missing or rejected ("Reconnect your repository")
 *   conflict    — a content conflict needs the author's attention
 *   error       — a transient/unexpected sync failure; treated like offline by the pill
 *   recovering  — automated repair in progress (translucent overlay, non-dismissable)
 *   recovered   — repair completed successfully; overlay auto-dismisses after ~1.8s
 */
export type SyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "up-to-date"
  | "offline"
  | "auth"
  | "conflict"
  | "error"
  | "recovering"
  | "recovered"
  // "local" — a local-git project with NO usable remote (none configured, or
  // SSH-only). No sync runs, but version history (auto-snapshots) is active;
  // the status pill shows a clickable "Previous versions" label.
  | "local"
  // "connect" — the repo HAS an HTTPS remote but print-md holds no usable
  // credential for it (the starting state of every repo cloned outside
  // print-md: GitHub Desktop, VS Code, plain git). One connect step away from
  // syncing — the pill and status summary surface a Connect action instead of
  // the misleading "kept on this computer" framing.
  | "connect";

// ── Recovery types — defined locally; no lib value import in the SPA ─────────
//
// These mirror the lib's recovery types but are defined here so the SPA never
// needs to value-import @dimm-city/print-md (§8 / ADR 0004). The host
// (electron/main.ts) maps the lib types to these before emitting.

/**
 * Progress information emitted while an automated repair is running.
 * Present on `SyncStatus` when `state === "recovering"`.
 */
export interface RecoveryProgressInfo {
  phase: "checking" | "backup" | "repairing" | "done";
  risk: "none" | "low" | "medium" | "high";
  message?: string;
}

/**
 * Machine token for the primary CTA — the host switches on this to route the
 * guidance dialog's primary button. Local mirror of the lib's
 * `RecoveryActionKey` (no lib value import in the SPA, §8 / ADR 0004).
 */
export type RecoveryActionKey =
  | "sync"
  | "reconnect"
  | "resolve_conflict"
  | "restore_repo"
  | "check_connection";

/**
 * Plain-language guidance shown when a repair is blocked or fails.
 * Local mirror of the lib's `ManualGuidance` — no git jargon in any field
 * except `supportDetails` (which is only shown behind a "Copy details" action).
 */
export interface ManualGuidanceInfo {
  userSummary: string;
  recommendedNextStep: string;
  recommendedAction: string;
  recommendedActionKey: RecoveryActionKey;
  safeNextSteps?: string[];
  supportDetails?: string;
  backupZipPath?: string;
}

/**
 * What a risky-repair confirmation dialog shows the author.
 * Local mirror of the lib's `RepairConfirmation`.
 */
export interface RepairConfirmationInfo {
  repair: string;
  risk: "none" | "low" | "medium" | "high";
  /** Plain-language summary — no git words. */
  summary: string;
  backupZipPath: string;
  willChangeLocalFiles: boolean;
  willChangeGitMetadata: boolean;
  willChangeRemote: boolean;
  canBeUndoneFromBackup: boolean;
}

/**
 * Payload sent from main to the renderer when a risky repair needs the
 * author's approval before proceeding.
 */
export interface RecoveryConfirmRequest {
  requestId: string;
  projectDir: string;
  confirmation: RepairConfirmationInfo;
}

/**
 * One conflicted file as carried on a `SyncStatus` "conflict" payload, with
 * the host's authoritative binary classification attached (L12 — 2026-07-10
 * UX review). `electron/recovery-bridge.ts`'s `isConflictFileBinary` /
 * `BINARY_EXTENSIONS` is the single source of truth; `ConflictChoicesDialog`
 * must not re-derive this from the file extension itself. `isBinary` is
 * optional because not every conflict-emit site can populate it yet — a
 * missing value means "unknown, ask the host" (see the preview-disclosure
 * fallback in `ConflictChoicesDialog.svelte` and the ids-fetch fallback path
 * in `sync-controller.svelte.ts`), never "known not to be binary".
 */
export interface ConflictFileEntry extends ConflictFileInfo {
  isBinary?: boolean;
}

/**
 * Payload pushed to the renderer whenever the auto-sync orchestrator's state
 * changes. `projectDir` scopes the event to one open project (the host may
 * manage multiple). `files` is populated only on `"conflict"`.
 */
export interface SyncStatus {
  state: SyncState;
  /** Absolute path of the project this status applies to. */
  projectDir: string;
  /**
   * Conflict file list — present (non-empty) only when `state === "conflict"`.
   * Uses `ConflictFileEntry` (defined above) so the shape stays single-sourced
   * and cannot drift from the lib's ConflictFile.kind values, while adding the
   * host-authoritative `isBinary` flag (L12).
   */
  files?: ConflictFileEntry[];
  /**
   * Local snapshot id backing the conflict resolution (M13 — 2026-07-10 UX
   * review). Carried directly on the payload so the renderer never needs a
   * SECOND network sync just to unlock ConflictChoicesDialog's primary
   * button. Present only when `state === "conflict"` AND the emitting host
   * path could compute it — the ambient auto-sync path
   * (`auto-sync/orchestrator.ts`) always can; the repair-driven conflict path
   * (`auto-sync/recovery-emit.ts`'s `needs_user` branch) forwards them
   * whenever the underlying `RecoveryResult` carries them (the
   * binary-conflict recovery producer threads its conflict tip OIDs through),
   * and only omits them for the text-merge conflict path, which doesn't
   * compute a tip pair. When absent, the renderer falls back to fetching the
   * ids via `syncChanges` (see `sync-controller.svelte.ts`'s
   * `conflictPending`/`conflictFetchFailed` states) instead of leaving the
   * primary button silently dead forever.
   */
  localId?: string;
  /** Remote snapshot id backing the conflict resolution — see {@link localId}. */
  remoteId?: string;
  /**
   * ISO-8601 timestamp of the last completed sync attempt, or null when none
   * has run in this session. Lets the pill show "last synced 2 min ago".
   */
  lastSyncAt: string | null;
  /**
   * Recovery progress info — present when `state === "recovering"`.
   * Drives the RecoveryOverlay progress copy.
   */
  recovery?: RecoveryProgressInfo;
  /**
   * Plain-language outcome/recovery message — present when `state === "error"`
   * and the emitting host path has one (a SyncOutcome or RecoveryResult always
   * carries author-facing copy, e.g. the insecure-transport guidance). Lets
   * the ambient pill explain WHY sync is paused (tooltip) instead of only the
   * generic error copy. Absent on the raw throw paths.
   */
  message?: string;
  /**
   * Manual guidance — present when `state === "error"` and the failure was
   * classified (not an unexpected throw). Drives the RecoveryGuidanceDialog.
   */
  guidance?: ManualGuidanceInfo;
  /**
   * Absolute path to the backup zip created before the repair attempt, when
   * one was made. Present on `"recovered"` and `"error"` (after a classified
   * failure) so the UI can offer "Show backup".
   */
  backupZipPath?: string;
  /**
   * Absolute path to the operation log file written during the sync/recovery
   * attempt. Present on `"recovered"`, `"error"`, and `"conflict"` states so
   * the UI can offer "View log" for debugging. The log contains timestamped
   * steps (fetch, merge, backup, etc.) but never secrets.
   */
  logFile?: string;
  /** True when the completed sync/recovery changed files in the local worktree. */
  filesChanged?: boolean;
}

// ── Sync (#15 sync phase, ADR 0006 D5) ────────────────────────────────────────
//
// ConflictKind, ConflictFileInfo, ConflictResolutionChoice, SyncOutcome,
// ResolveSyncConflictsArgs, ConnectGenericHostArgs, HostConnectionInfo
// imported from shared-types above (re-exported at the top of this file).

// ── User settings (#45) ──────────────────────────────────────────────────────
//
// AppSettings AND DEFAULT_SETTINGS are both imported from shared-types.ts
// (#29) — no more hand-duplicated copy here or in
// electron/settings-store.ts. Adding a new setting: add the key + default to
// `DEFAULT_SETTINGS` in shared-types.ts (the ONE place); a matching UI
// control in SettingsView.svelte is the only other change needed.
export { DEFAULT_SETTINGS } from "./shared-types";

// DeepPartial, PreviewStartResult, BuildResult, ExportProgressEvent,
// UrlPreviewBlockedEvent imported from shared-types above (re-exported at
// the top of this file).

export interface PreviewStartArgs {
  input: FolderRef;
}

export interface BuildArgs {
  input: FolderRef;
  format: "pdf" | "html" | "pdfx";
  out?: string;
  title?: string;
  pdfxFlavor?: string;
  icc?: string;
  manifest?: string;
  stripAnnotations?: boolean;
  skipLint?: boolean;
  skipPreValidate?: boolean;
  skipPostValidate?: boolean;
}

/** OS appearance state (#48). Resolved against "system" theme mode. */
export interface NativeThemeState {
  shouldUseDarkColors: boolean;
}

/**
 * Coarse host capability flags (#49) so the UI can degrade gracefully without
 * branching on `platform === "web"`. Electron returns all-true; the Web adapter
 * returns the conservative set (see WebAdapter.capabilities for the Safari/OPFS
 * rationale).
 */
export interface PlatformCapabilities {
  /** The host can write build output to a real, user-chosen filesystem path. */
  nativeSavePath: boolean;
  /** The host can reveal a file/folder in the OS file manager. */
  showInFolder: boolean;
  /** The host can persist a folder handle across sessions (FSA on PWA). */
  persistentFolderAccess: boolean;
}

/**
 * Host RPC services. Host-divergent (IPC vs HTTP) but not part of the narrow
 * filesystem/secrets primitive surface, so kept separate from PlatformAdapter.
 */
export interface HostServices {
  /** Integer IPC-surface version; mirrors DESKTOP_API in electron/preload.ts. */
  readonly apiVersion: number;
  readonly updater: UpdaterApi;

  /**
   * Coarse host capability flags (#49). Lets the UI degrade gracefully
   * (Safari/OPFS) without branching on the platform name. Electron: all-true.
   */
  capabilities(): PlatformCapabilities;

  // Native (OS) theme (#48) — push channel kept (main→renderer push, not request/reply)
  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void;

  /**
   * Subscribe to `.md` launches from the desktop shell. Initial paths are
   * replayed before a `ready` sentinel; later Finder/Explorer launches stream
   * through the same callback. WebAdapter never emits.
   */
  onOpenMarkdownFile(cb: (event: MarkdownFileLaunchEvent) => void): () => void;

  // ── Local version history (#13) ───────────────────────────────────────────
  /**
   * Save an explicit snapshot of the project's current state. `message` is
   * optional author text; the host substitutes a default when blank. Rejects
   * with a friendly message when nothing has changed since the last snapshot.
   */
  saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry>;

  // ── Managed GitHub integration (#15, ADR 0006) ────────────────────────────
  // Two-phase connect: `connectGitHubStart` begins the device flow and
  // resolves with the code to show the user; `connectGitHubWait` resolves once
  // the user approves in the browser (the host stores the credential — the
  // renderer only ever sees redacted status). The WebAdapter stubs reject.

  /** Begin the GitHub device flow; resolves with the code/URL to display. */
  connectGitHubStart(): Promise<DeviceCodeInfo>;
  /** Await user approval of the in-flight device flow. */
  connectGitHubWait(): Promise<RemoteConnection>;
  /** Cancel an in-flight device flow (user closed the dialog). */
  connectGitHubCancel(): Promise<{ ok: boolean }>;

  /** Download ("clone") a repository into a new local project folder. */
  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
  /** Subscribe to clone progress events. Returns an unsubscribe fn. */
  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ───
  //
  // The host auto-sync orchestrator (electron/main.ts) emits `sync:status`
  // events whenever its state machine transitions. The renderer subscribes here
  // to drive the ambient status pill without polling.

  /**
   * Subscribe to ambient sync-status updates from the host orchestrator.
   * The handler fires on every subsequent transition (`syncing`, `synced`,
   * `offline`, `auth`, `conflict`, `recovering`, `recovered`, …). NOTE: there
   * is NO initial replay — a handler that subscribes after a sync has already
   * settled stays uninvoked until the next transition, so callers should render
   * a sensible default (e.g. blank/idle) until the first event. Returns an
   * unsubscribe fn — call it in `onDestroy` to prevent leaks. The WebAdapter
   * stub never emits and returns a no-op unsubscribe.
   */
  onSyncStatus(handler: (status: SyncStatus) => void): () => void;

  // ── Sync recovery seam (Foundation — §8 / ADR 0004) ───────────────────────
  //
  // Recovery runs in the host (main.ts). These three methods are the only
  // recovery-related surface the renderer needs:
  //   1. Receive risky-repair confirmation requests from main.
  //   2. Send the author's answer back to main.
  //   3. Fetch yours/theirs text for the conflict-preview disclosure.
  //
  // All git/lib work stays in main. Credentials never cross this seam.

  /**
   * Subscribe to risky-repair confirmation requests from the host. When the
   * recovery subsystem needs the author to approve a medium/high-risk repair
   * before proceeding, it sends a `RecoveryConfirmRequest` here. The renderer
   * shows `RecoveryConfirmDialog` and calls `respondRecoveryConfirm` with the
   * author's answer. Returns an unsubscribe fn.
   * WebAdapter: returns a no-op unsubscribe (recovery is desktop-only).
   */
  onRecoveryConfirm(handler: (req: RecoveryConfirmRequest) => void): () => void;

  /**
   * Send the author's approval or rejection back to main to unblock a pending
   * risky repair. `requestId` must match the id in the `RecoveryConfirmRequest`.
   * WebAdapter: resolves immediately (no-op).
   */
  respondRecoveryConfirm(requestId: string, approved: boolean): Promise<void>;

  /**
   * Enable or disable the auto-sync master switch for the current project.
   * Persisted via the host settings store (equivalent to toggling
   * `versionHistory.autoSync` in AppSettings). The WebAdapter stub is a no-op
   * (auto-sync is desktop-only until the PWA lands).
   */
  setAutoSync(enabled: boolean): Promise<void>;

  // ── Sync (#15 sync phase, ADR 0006 D5) ─────────────────────────────────────
  /** Apply per-file conflict choices and sync the combined result. */
  resolveSyncConflicts(args: ResolveSyncConflictsArgs): Promise<SyncOutcome>;

  // Preview / build
  startPreview(args: PreviewStartArgs): Promise<PreviewStartResult>;
  stopPreview(): Promise<{ stopped: boolean }>;
  cancelExport(exportId: string): Promise<{ canceled: boolean }>;
  build(args: BuildArgs): Promise<BuildResult>;

  // Event subscriptions (return an unsubscribe fn)
  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void;
  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void;

  /**
   * Subscribe to the main process's request to flush before the window closes
   * (#44). Returning false reports that the buffer did not reach disk; main
   * records the durable failure marker and still closes after bounded waits.
   */
  onFlushBeforeClose(cb: () => boolean | void | Promise<boolean | void>): () => void;
  /**
   * Subscribe to debounced folder-change notifications for the open project
   * (#44), backing external-edit detection. Returns an unsubscribe fn.
   */
  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void;
}

/**
 * The complete host surface the viewer app consumes through `getPlatform()`.
 *
 * `openFolder` is overridden here (#49) to return a host-neutral `FolderRef`
 * instead of the lib `PlatformAdapter`'s raw `string` path — so the renderer
 * never assumes path-string semantics. The adapter is the translation seam
 * (Electron wraps the picker's path; the WebAdapter already returns an FSA
 * handle-registry ref today — see web-adapter.ts — though it is dormant/
 * unreachable until the #33 PWA milestone wires it up). Every other
 * `PlatformAdapter` primitive is inherited unchanged.
 */
export interface Platform extends Omit<PlatformAdapter, "openFolder">, HostServices {
  /**
   * Open a native folder picker. Resolves with a {@link FolderRef} (key +
   * precomputed displayName), or null when the user cancels. The Electron
   * adapter wraps the chosen absolute path; the Web adapter genuinely opens
   * the FSA directory picker (see web-adapter.ts) — dormant, not a stub.
   */
  openFolder(): Promise<FolderRef | null>;

}
// NOTE: reopenFolder was removed from HostServices (no SPA caller in v1).
// The WebAdapter retains its implementation for the FSA permission re-grant
// flow that will be wired up when the PWA ships.

/**
 * The raw `window.electron` bridge shape exposed by `electron/preload.ts`.
 * Differs from `Platform` only in the members the adapter maps/owns: the fs IPC
 * (`openDirectory` → `Platform.openFolder`, `readFile`, `writeFile`), the
 * FolderRef translation seam (`startPreview`/`build` keep raw path strings here;
 * #49), and `capabilities()` (synthesised by the adapter, not an IPC — Omitted
 * so it can't be called on the raw bridge).
 * ONLY `electron-adapter.ts` (and the `Window` global) should reference this —
 * everything else goes through `Platform`.
 */
export interface ElectronBridge
  extends Omit<
    HostServices,
    | "startPreview"
    | "build"
    | "capabilities"
    // ARCH review #8: these three moved to server routes (api.sync.setAutoSync
    // / api.remote.{cloneRepository,resolveSyncConflicts}) — the raw bridge no
    // longer exposes them. `updater` is narrowed below instead of omitted:
    // applyNow/onEvent stay on the bridge, only getStatus/check/download moved.
    | "setAutoSync"
    | "cloneRemoteRepository"
    | "resolveSyncConflicts"
    | "updater"
  > {
  // audit D3: openDirectory/readFile/writeFile/listDir/statFile were removed
  // from here — the real preload bridge migrated them to server routes (the
  // ElectronAdapter's PlatformAdapter methods call api.dialog.*/api.fs.*, never
  // bridge().*), so the type promised IPC members that don't exist. Matches the
  // already-pruned electron/types.d.ts.
  // #49: the IPC layer keeps raw path-string semantics — the ElectronAdapter is
  // the translation seam that unwraps FolderRef.key back into the string `input`
  // the existing IPC expects.
  startPreview(args: { input: string } & Omit<PreviewStartArgs, "input">): Promise<PreviewStartResult>;
  build(args: { input: string } & Omit<BuildArgs, "input">): Promise<BuildResult>;
  /**
   * Raw folder-watch IPC behind `PlatformAdapter.watchFolder` (#44). Subscribes
   * to change events for `path` and returns an unsubscribe fn.
   */
  watchFolder(path: string, cb: () => void): () => void;
  /**
   * ARCH review #8: getStatus/check/download migrated to server routes
   * (api.updater.*) — the raw bridge only carries applyNow (quit + install,
   * a live-BrowserWindow flush) and the onEvent push subscription.
   */
  updater: Pick<UpdaterApi, "applyNow" | "onEvent">;
}
