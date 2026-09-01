/**
 * Desktop-facing platform contract (#41, ARCH review #39).
 *
 * `PlatformAdapter` (the narrow, genuinely host-divergent primitive surface) is
 * the canonical contract and lives in `gutterpress`. The desktop adds
 * `HostServices` — the host RPC surface (preview/build/doctor/prefs/updater/
 * dialogs), which is desktop-specific (Electron IPC), so it is defined here
 * rather than in the lib.
 *
 * The app consumes `Platform` = `PlatformAdapter & HostServices` via
 * `getPlatform()`. It must NOT touch `window.electron` directly — that access
 * is confined to `electron-adapter.ts`.
 *
 * This file is the SEAM-INTERFACE file: `HostServices`, `ElectronBridge`,
 * `Platform`, and the small cluster of types those interfaces' members
 * reference directly (`UpdaterApi`, `FolderRef`/`FileRef`, `PreviewStartArgs`/
 * `BuildArgs`, `PlatformCapabilities`, `NativeThemeState`,
 * `FolderChangedEvent`, and the sync status vocabulary —
 * `SyncStatus`/`SyncState`). Plain request/response DTOs that the seam does NOT
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
} from "gutterpress";
// SFE-P3e — CAVEAT (mirrors the ProjectSource/ProjectCapabilities caveat
// below): the desktop rich editor's projection wraps D6's own
// `GutterpressProjection` shape, so this file type-imports it straight from
// the render subpath rather than hand-mirroring it into shared-types.ts (§8-
// safe: `import type` is erased at build, never a runtime SPA import).
import type { GutterpressProjection } from "gutterpress/render";

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
  DesktopPrefs as SharedDesktopPrefs,
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
  SyncOutcome,
  KeptBothFile,
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
  SyncOutcome,
  KeptBothFile,
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
 * UI makes no assumptions about path-string semantics. On Electron (the only
 * host this contract resolves to — SFE-P5a/D10) the `key` is the folder's
 * absolute path. The `displayName` is precomputed by the adapter (the folder
 * basename) so the UI never has to split a path itself.
 */
export interface FolderRef {
  /** Stable key for equality / dedup / persistence. Electron: absolute path. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}

/**
 * A host-neutral reference to a FILE (#61), analogous to {@link FolderRef}.
 *
 * The app-facing contract returns a `FileRef` from the native file picker
 * instead of a raw path string, so the UI makes no assumptions about
 * path-string semantics. On Electron the `key` is the file's absolute path.
 * The `displayName` is precomputed by the adapter (the file basename) so the
 * UI never has to split a path itself.
 */
export interface FileRef {
  /** Stable key for IPC / persistence. Electron: absolute path. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}

// ProjectState and DesktopPrefs are imported from shared-types above
// (re-exported at the top of this file). DesktopPrefs.leftPanel is typed as
// LeftPanelPrefs — both defined in shared-types.ts and re-exported here.

export type { SharedDesktopPrefs as DesktopPrefs, LeftPanelPrefs };

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
// alongside HostServices (rather than in ./dtos) because `onSyncStatus`
// references this cluster directly.

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

// ── Sync (#15 sync phase, ADR 0006 D5) ────────────────────────────────────────
//
// SyncOutcome, KeptBothFile, ConnectGenericHostArgs, HostConnectionInfo
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
  /**
   * Proceed past the engine's over-wide-content check, which is otherwise a
   * hard error (#163). The host accepted this all along; without it here the
   * engine's own "pass allowShrink to build anyway" advice was unreachable
   * from the only export path a desktop author has. Opt-in per export — the
   * whole document prints scaled down, so it is never a stored default.
   */
  allowShrink?: boolean;
}

/** Arguments for {@link HostServices.buildEditorProjection} (SFE-P3e). No
 *  FolderRef translation is needed here (unlike {@link PreviewStartArgs}/
 *  {@link BuildArgs}) — `projectDir` is a plain path string on both sides;
 *  the host validates it against its own open-workspace state. */
export interface EditorProjectionArgs {
  readonly projectDir: string;
  readonly content: string;
  readonly sourceVersion: number;
}

/** One project plugin that failed to load (D14 `EDITOR_PLUGIN_LOAD_FAILED`), degrade-and-report style. */
export interface EditorProjectionPluginError {
  readonly pluginRef: string;
  readonly message: string;
}

/** Result of {@link HostServices.buildEditorProjection}. */
export interface EditorProjectionResult {
  readonly projection: GutterpressProjection;
  readonly pluginCss: string;
  readonly pluginErrors: readonly EditorProjectionPluginError[];
}

/** D14 classification codes {@link HostServices.buildEditorProjection} can
 *  resolve with instead of succeeding. */
export type EditorProjectionFailureCode = "EDITOR_FILE_TOO_LARGE" | "EDITOR_PLUGIN_LOAD_FAILED";

/**
 * {@link HostServices.buildEditorProjection}'s actual return shape (SFE-P3e
 * review round 2, CONFIRMED finding): a RESOLVED discriminated union, never
 * a rejection carrying the failure classification. Electron's IPC boundary
 * serializes a rejected `ipcMain.handle` error by stringifying it — the
 * renderer's `ipcRenderer.invoke` rejection carries a reconstructed `Error`
 * with only `message`/`stack`, never a custom own-property such as `.code`
 * — so `EDITOR_FILE_TOO_LARGE`/`EDITOR_PLUGIN_LOAD_FAILED` could never have
 * reached a caller that branched on a thrown error's `.code`, which is
 * exactly the shape this used to be before this fix. Local to this file
 * (D4: renderer types are decoupled from the lib/host, defined here rather
 * than imported from `electron/editor-projection.ts`'s own
 * `EditorProjectionOutcome` — this is that same shape's renderer-side
 * mirror, kept structurally in sync by hand like `EditorProjectionResult`
 * above already is). */
export type EditorProjectionOutcome =
  | ({ readonly ok: true } & EditorProjectionResult)
  | { readonly ok: false; readonly code: EditorProjectionFailureCode; readonly message: string };

/** OS appearance state (#48). Resolved against "system" theme mode. */
export interface NativeThemeState {
  shouldUseDarkColors: boolean;
}

/**
 * Coarse host capability flags (#49) so the UI can degrade gracefully without
 * branching on the platform discriminant directly. Electron (the only host
 * `getPlatform()` resolves — SFE-P5a/D10) returns all-true.
 */
export interface PlatformCapabilities {
  /** The host can write build output to a real, user-chosen filesystem path. */
  nativeSavePath: boolean;
  /** The host can reveal a file/folder in the OS file manager. */
  showInFolder: boolean;
  /** The host can persist a folder handle across sessions. */
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
   * without branching on the platform name. Electron: all-true.
   */
  capabilities(): PlatformCapabilities;

  // Native (OS) theme (#48) — push channel kept (main→renderer push, not request/reply)
  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void;

  /**
   * Subscribe to `.md` launches from the desktop shell. Initial paths are
   * replayed before a `ready` sentinel; later Finder/Explorer launches stream
   * through the same callback.
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
  // renderer only ever sees redacted status).

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

  /**
   * SFE-P3e — the desktop rich editor's plugin-aware projection, built
   * host-side: the OPEN project's real manifest and real loaded plugins
   * (degrade-and-report — a plugin that fails to load is skipped, reported
   * in `pluginErrors`, and never blanks the projection). Electron only —
   * this run's renderer wiring only calls this when a desktop project is
   * open, matching D10.
   *
   * Resolves to {@link EditorProjectionOutcome} — `ok: false` for the two
   * classified hard-failure shapes (D13's rich-mode ceiling; a manifest
   * that fails to load outright), never a rejection for either (SFE-P3e
   * review round 2 — see that type's own doc comment for why).
   */
  buildEditorProjection(args: EditorProjectionArgs): Promise<EditorProjectionOutcome>;

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
 * The complete host surface the desktop app consumes through `getPlatform()`.
 *
 * `openFolder` is overridden here (#49) to return a host-neutral `FolderRef`
 * instead of the lib `PlatformAdapter`'s raw `string` path — so the renderer
 * never assumes path-string semantics. The adapter is the translation seam
 * (Electron wraps the picker's path in a `FolderRef` whose `key` is that
 * absolute path). Every other `PlatformAdapter` primitive is inherited
 * unchanged.
 */
export interface Platform extends Omit<PlatformAdapter, "openFolder">, HostServices {
  /**
   * Open a native folder picker. Resolves with a {@link FolderRef} (key +
   * precomputed displayName), or null when the user cancels.
   */
  openFolder(): Promise<FolderRef | null>;

}
// NOTE: reopenFolder was removed from HostServices (no SPA caller) and its
// only implementation (the FSA permission re-grant flow on the now-deleted
// WebAdapter, SFE-P5a) was deleted with it — see D10.

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
    // ARCH review #8: these moved to server routes (api.sync.setAutoSync
    // / api.remote.cloneRepository) — the raw bridge no longer exposes them.
    // `updater` is narrowed below instead of omitted: applyNow/onEvent stay
    // on the bridge, only getStatus/check/download moved.
    | "setAutoSync"
    | "cloneRemoteRepository"
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
