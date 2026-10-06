/**
 * Desktop-facing platform contract (#41).
 *
 * `PlatformAdapter` (the narrow, genuinely host-divergent primitive surface) is
 * the canonical contract and lives in `gutterpress`. The desktop adds
 * `HostServices` — the host RPC surface (preview/build/updater/push events)
 * that is desktop-specific, so it is defined here rather than in the lib.
 *
 * The app consumes `Platform` (part of `PlatformAdapter` + `HostServices`) via
 * `getPlatform()`. It must NOT touch `window.electron` directly — that access
 * is confined to `electron-adapter.ts`.
 *
 * This file is the SEAM-INTERFACE file: `HostServices`, `ElectronBridge`,
 * `Platform`, and the small cluster of types those interfaces' members
 * reference directly (`UpdaterApi`, `FolderRef`, `PreviewStartArgs`/
 * `BuildArgs`, `NativeThemeState`,
 * `FolderChangedEvent`, and the sync status vocabulary —
 * `SyncStatus`/`SyncState`). Plain request/response DTOs that the seam does NOT
 * reference — the ~30 shapes server routes return (extension manager,
 * style resolver, media panel, problems panel, project
 * classification, …) — live in `./dtos.ts`. IPC payload types shared with the
 * Electron host process live in `./shared-types.ts`. This file re-exports both so existing `$lib/platform/
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
} from "gutterpress";

// Shared IPC payload types — imported from the single source of truth
// (shared-types.ts), which the Electron host imports directly too, so these
// types cannot drift between the host and renderer sides.
import type {
  UpdaterStatus,
  UpdaterEventPayload,
  UpdaterAvailableAction,
  AppSettings,
  DeepPartial,
  ProjectState,
  DesktopPrefs as SharedDesktopPrefs,
  LeftPanelPrefs,
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
  RemoteAccessResult,
  ProjectRemoteDiagnosis as SharedProjectRemoteDiagnosis,
  SyncOutcome,
  KeptBothFile,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishDestination,
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
  GoogleConnectStartResult,
  GoogleConnectResult,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  RemoteAccessResult,
  SyncOutcome,
  KeptBothFile,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishDestination,
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
 * `key` is the folder's absolute path; `displayName` is its basename,
 * precomputed so the UI never has to split a path itself.
 */
export interface FolderRef {
  /** Stable key for equality / dedup / persistence: the absolute path. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}


// ProjectState and DesktopPrefs are imported from shared-types above
// (re-exported at the top of this file). DesktopPrefs.leftPanel is typed as
// LeftPanelPrefs — both defined in shared-types.ts and re-exported here.

export type { SharedDesktopPrefs as DesktopPrefs, LeftPanelPrefs };

// ── Managed GitHub integration (#15) ──────────────────────────────────────────
//
// DeviceCodeInfo, RemoteConnection, RemoteRepository, RemoteBranch, RepoBook,
// CloneProgressEvent, CloneRepositoryArgs imported from shared-types above
// (re-exported at the top of this file).

// ── Advanced Setup (#14) ──────────────────────────────────────────────────────
//
// RemoteAccessResult and ProjectRemoteDiagnosis imported from shared-types above
// (re-exported at the top of this file). Refined ForgeKind / RemoteGuidanceId
// named aliases live in ./dtos (not part of the seam).

/** Environment status for the Advanced Setup panel — re-exported from shared-types. */
export type { SharedProjectRemoteDiagnosis as ProjectRemoteDiagnosis };

// ── Auto-sync orchestrator status (transparent sync) ────────────────────────
//
// Defined locally here — decoupled from the lib — so the SPA never
// value-imports the lib (§8). Main emits `sync:status` events with
// this payload; the renderer drives the ambient status pill from it. Kept
// alongside HostServices (rather than in ./dtos) because `onSyncStatus`
// references this cluster directly.

/**
 * Ambient sync state emitted by the host auto-sync orchestrator and surfaced
 * to the renderer via the `onSyncStatus` subscription.
 *
 * States:
 *   idle        — no sync scheduled or needed (local-only project, or auto-sync OFF)
 *   syncing     — commit→fetch→merge→push in flight ("Syncing…")
 *   synced      — last sync completed and remote is up to date
 *   up-to-date  — sync ran; nothing needed (no local or remote changes)
 *   offline     — network unavailable; changes are saved locally
 *   auth        — credential missing or rejected ("Reconnect your repository")
 *   error       — a transient/unexpected sync failure; treated like offline by the pill
 */
export type SyncState =
  | "idle"
  | "syncing"
  // "synced" — the sync completed, whether or not it had anything to send.
  // The lib's SyncOutcome still distinguishes "synced" from "up-to-date"
  // (manual Sync toasts that difference); the ambient pill never did.
  | "synced"
  | "offline"
  | "auth"
  | "error"
  // "local" — a local-git project with NO usable remote (none configured, or
  // SSH-only). No sync runs, but version history (auto-snapshots) is active;
  // the status pill shows a clickable "Previous versions" label.
  | "local"
  // "connect" — the repo HAS an HTTPS remote but Gutterpress holds no usable
  // credential for it (the starting state of every repo cloned outside
  // Gutterpress: GitHub Desktop, VS Code, plain git). One connect step away from
  // syncing — the pill and status summary surface a Connect action instead of
  // the misleading "kept on this computer" framing.
  | "connect";

/**
 * Payload pushed to the renderer whenever the auto-sync orchestrator's state
 * changes. `projectDir` scopes the event to one open project (the host may
 * manage multiple).
 */
export interface SyncStatus {
  state: SyncState;
  /** Absolute path of the project this status applies to. */
  projectDir: string;
  /**
   * ISO-8601 timestamp of the last completed sync attempt, or null when none
   * has run in this session. Lets the pill show "last synced 2 min ago".
   */
  lastSyncAt: string | null;
  /**
   * Plain-language outcome message — present when `state === "error"` and the
   * emitting host path has one (a SyncOutcome always carries author-facing
   * copy, e.g. the insecure-transport guidance). Lets the ambient pill explain
   * WHY sync is paused (tooltip) instead of only the generic error copy.
   * Absent on the raw throw paths.
   */
  message?: string;
  /**
   * Absolute path to the operation log file written during the sync attempt.
   * Present on `"error"` so the UI can offer "View log" for debugging.
   * Timestamped steps, never secrets.
   */
  logFile?: string;
  /**
   * Which part of the product this status is about. Absent = the online
   * backup. "versions" = the automatic-version safety net failed (it reuses
   * this channel with state "error"), which must NOT read as a backup failure.
   */
  source?: "versions";
  /** True when the completed sync changed files in the local worktree. */
  filesChanged?: boolean;
  /**
   * Files whose text now holds BOTH versions inside standard git conflict
   * markers (the converge merge) — the toast tells the writer to review them.
   * Present on "synced" after a combining sync.
   */
  combinedFiles?: string[];
  /**
   * Files that changed on both sides and can't hold conflict markers: ours
   * stayed at `path`, the online version was saved beside it at
   * `onlinePath`. Present after a combining sync.
   */
  keptBothFiles?: KeptBothFile[];
}

// ── Sync (#15) ────────────────────────────────────────────────────────────────
//
// SyncOutcome, KeptBothFile, ConnectGenericHostArgs, HostConnectionInfo
// imported from shared-types above (re-exported at the top of this file).

// ── User settings (#45) ──────────────────────────────────────────────────────
//
// AppSettings AND DEFAULT_SETTINGS are both imported from shared-types.ts
// (#29), as is electron/settings-store.ts. Adding a new setting: add the key + default to
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
  /**
   * Proceed past the engine's over-wide-content check, which is otherwise a
   * hard error (#163). The host accepted this all along; without it here the
   * engine's own "pass allowShrink to build anyway" advice was unreachable
   * from the only export path a desktop author has. Opt-in per export — the
   * whole document prints scaled down, so it is never a stored default.
   */
  allowShrink?: boolean;
}

/** OS appearance state (#48). Resolved against "system" theme mode. */
export interface NativeThemeState {
  shouldUseDarkColors: boolean;
}

/**
 * Host RPC services. Host-divergent (IPC vs HTTP) but not part of the narrow
 * filesystem/secrets primitive surface, so kept separate from PlatformAdapter.
 */
export interface HostServices {
  readonly updater: UpdaterApi;

  // Native (OS) theme (#48) — push channel kept (main→renderer push, not request/reply)
  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void;

  /**
   * Subscribe to `.md` launches from the desktop shell. Initial paths are
   * replayed before a `ready` sentinel; later Finder/Explorer launches stream
   * through the same callback.
   */
  onOpenMarkdownFile(cb: (event: MarkdownFileLaunchEvent) => void): () => void;

  // ── Managed GitHub integration (#15) ──────────────────────────────────────
  // Two-phase connect: `connectGitHubStart` begins the device flow and
  // resolves with the code to show the user; `connectGitHubWait` resolves once
  // the user approves in the browser (the host stores the credential — the
  // renderer only ever sees redacted status).

  /** Begin the GitHub device flow; resolves with the code/URL to display. */
  connectGitHubStart(): Promise<DeviceCodeInfo>;
  /** Await user approval of the in-flight device flow. */
  connectGitHubWait(): Promise<RemoteConnection>;
  /** Cancel an in-flight device flow (user closed the dialog). */
  connectGitHubCancel(): Promise<{ ok: boolean }>;

  // ── Google Drive publish connect (#221, ADR 0011) ──
  // Same two-phase shape as the GitHub trio above, mirrored deliberately (the
  // recorded alternative — a route trio on the publish hooks bridge — was
  // passed over so the app keeps ONE pattern for interactive OAuth connects).
  // There is no user code to display: `connectGoogleStart` resolves with the
  // auth URL the browser was (or should be) sent to, for a "didn't open?
  // click here" fallback link.

  /** Begin the Google Drive OAuth connect flow; resolves with the auth URL to
   *  offer as a fallback link. An optional `account` label connects a NAMED
   *  credential (mirrors the publish token-paste flow's account label). */
  connectGoogleStart(account?: string): Promise<GoogleConnectStartResult>;
  /** Await user approval of the in-flight connect (the credential is stored
   *  by the host — the renderer only ever sees this redacted result). */
  connectGoogleWait(): Promise<GoogleConnectResult>;
  /** Cancel an in-flight connect attempt (user closed the dialog). */
  connectGoogleCancel(): Promise<{ ok: boolean }>;

  /** Download ("clone") a repository into a new local project folder. */
  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
  /** Subscribe to clone progress events. Returns an unsubscribe fn. */
  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;

  // ── Auto-sync orchestrator seam (transparent sync) ──────────────────────────
  //
  // The host auto-sync orchestrator (electron/main.ts) emits `sync:status`
  // events whenever its state machine transitions. The renderer subscribes here
  // to drive the ambient status pill without polling.

  /**
   * Subscribe to ambient sync-status updates from the host orchestrator.
   * The handler fires on every subsequent transition (`syncing`, `synced`,
   * `offline`, `auth`, `error`, …). NOTE: there
   * is NO initial replay — a handler that subscribes after a sync has already
   * settled stays uninvoked until the next transition, so callers should render
   * a sensible default (e.g. blank/idle) until the first event. Returns an
   * unsubscribe fn — call it in `onDestroy` to prevent leaks.
   */
  onSyncStatus(handler: (status: SyncStatus) => void): () => void;

  /**
   * Enable or disable the auto-sync master switch for the current project.
   * Persisted via the host settings store (equivalent to toggling
   * `versionHistory.autoSync` in AppSettings).
   */
  setAutoSync(enabled: boolean): Promise<void>;

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
  onFlushBeforeClose(cb: (mode?: "flush" | "discard") => boolean | void | Promise<boolean | void>): () => void;
  /**
   * Subscribe to debounced folder-change notifications for the open project
   * (#44), backing external-edit detection. Returns an unsubscribe fn.
   */
  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void;
}

/**
 * The complete host surface the desktop app consumes through `getPlatform()`:
 * the lib's `PlatformAdapter` file primitives plus `HostServices`.
 */
export interface Platform extends PlatformAdapter, HostServices {}

/**
 * The raw `window.electron` bridge shape exposed by `electron/preload.ts`.
 * Differs from `HostServices` only in the members the adapter maps: the
 * FolderRef translation seam (`startPreview`/`build` keep raw path strings here;
 * #49) and the calls served by server routes.
 * ONLY `electron-adapter.ts` (and the `Window` global) should reference this —
 * everything else goes through `Platform`.
 */
export interface ElectronBridge
  extends Omit<
    HostServices,
    | "startPreview"
    | "build"
    // These are server routes (api.sync.setAutoSync /
    // api.remote.cloneRepository) — the raw bridge doesn't expose them.
    // `updater` is narrowed below instead of omitted: applyNow/onEvent stay
    // on the bridge, only getStatus/check/download are routes.
    | "setAutoSync"
    | "cloneRemoteRepository"
    | "updater"
  > {
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
   * getStatus/check/download are server routes (api.updater.*) — the raw
   * bridge only carries applyNow (quit + install,
   * a live-BrowserWindow flush) and the onEvent push subscription.
   */
  updater: Pick<UpdaterApi, "applyNow" | "onEvent">;
}
