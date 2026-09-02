/**
 * Desktop-facing seam types (#41, ARCH review #39, narrowed SFE-P5b).
 *
 * Through 0.10.x this file defined the broad `Platform`/`HostServices`
 * service-locator contract (`PlatformAdapter & HostServices`, consumed via
 * `getPlatform()`). SFE-P5b deleted that locator: `getPlatform()`,
 * `ElectronAdapter`, the `Platform` and `HostServices` interfaces, and
 * `PlatformAdapter`'s desktop-side re-export are all gone. Each capability a
 * component needs is now a plain function imported directly from a
 * feature-owned module (`$lib/update/updater-capability`,
 * `$lib/remote/remote-capability`, `$lib/export/build-preview-capability`,
 * `$lib/editor-host/editor-projection-capability`,
 * `$lib/app-lifecycle/app-lifecycle-capability`, or inlined in
 * `theme.svelte.ts`) — see `docs/plans/source-first-editor/capability-map.md`
 * for the full member-by-member accounting and `./bridge.ts` for the one
 * shared `window.electron` accessor those modules call.
 *
 * What remains here:
 *
 * - `ElectronBridge` — types the REAL preload boundary. It is a genuine
 *   duplicate of the ambient `Window.electron` shape `electron/types.d.ts`
 *   declares (out of this run's write ownership) — kept, not deleted,
 *   because `src/app.d.ts` (also out of this run's write ownership) imports
 *   it by name to type the SPA's own `Window.electron` ambient declaration
 *   (a separate `declare global` scope from `electron/types.d.ts`'s
 *   main/preload TS program, which the SPA's tsconfig does not include).
 *   Verified member-for-member against `electron/types.d.ts` as part of this
 *   run (capability-map.md §"ElectronBridge parity") — the one drift found
 *   (a stale `saveSnapshot` member that was never really on the bridge) is
 *   fixed below.
 * - `UpdaterApi` — still typed here, but NOT because `updater-capability.ts`
 *   needs the full shape: that module imports only `UpdaterEvent`/
 *   `UpdaterStatus` (its five functions are typed by their own return
 *   values, not by `UpdaterApi` itself). The real reason is
 *   `ElectronBridge.updater: Pick<UpdaterApi, "applyNow" | "onEvent">` below
 *   — `UpdaterApi` has zero consumers outside this file and the (now
 *   trimmed, see `./index.ts`) barrel re-export it used to have.
 * - `EditorProjectionArgs`/`EditorProjectionOutcome`/
 *   `EditorProjectionPluginError` (and their two supporting shapes) moved
 *   OUT to `$lib/editor-host/editor-projection-capability` (SFE-P5b review
 *   round 1) — that module is this run's one declared exception to "pure
 *   forwarding dies" (capability-map.md §3), and once a capability module
 *   is kept as a deliberate exception its DTOs move with it. `ElectronBridge`
 *   below imports them back with a type-only import: a circular *module*
 *   reference (that file also imports the value `bridge` from `./bridge`,
 *   which imports the type `ElectronBridge` from here) but not a circular
 *   *runtime* one — `import type` is erased before bundling.
 * - `PlatformCapabilities` moved OUT to
 *   `$lib/export/build-preview-capability` (SFE-P5b review round 1) — it
 *   was never actually referenced by `ElectronBridge` (`capabilities()` was
 *   never a bridge member; `getPlatformCapabilities()` is a local
 *   synthesis, not an IPC call — see that function's own doc comment), so
 *   the "cycle" justification below never applied to it; it simply had not
 *   been moved yet.
 * - Every other type below (`FolderRef`/`FileRef`, `PreviewStartArgs`/
 *   `BuildArgs`, `NativeThemeState`, `FolderChangedEvent`,
 *   `SyncState`/`SyncStatus`, `DesktopPrefs`, `UpdaterApi`, the re-exported
 *   IPC payload types) stays here rather than moving to its consuming
 *   capability module. Two different reasons, not one blanket claim:
 *     - `FolderRef`/`PreviewStartArgs`/`BuildArgs`/`NativeThemeState`/
 *       `FolderChangedEvent`/`UpdaterApi` are referenced by `ElectronBridge`
 *       directly, so moving them would create the same type-only cycle
 *       described above for the editor-projection types — technically safe
 *       (type-only cycles are erased at build, as that move proves), but
 *       this run judged spreading that pattern across every capability
 *       module a bigger readability cost than the one deliberate exception
 *       justifies, and deferred it. Not moved this run; a candidate for
 *       P5c to revisit per-module as it takes ownership of the surrounding
 *       `api.ts` surface.
 *     - `FileRef`/`DesktopPrefs`/`SyncState`/`SyncStatus` and the
 *       re-exported IPC payload types have real consumers outside this
 *       run's write ownership (e.g. `LeftPanel.svelte`'s
 *       `ProjectCapabilities`, `api.ts`'s `FileStat`/`FileWriteResult`) that
 *       this run may not edit, so they stay in the one shared IPC-DTO
 *       module those genuinely cross-cutting types already lived in.
 *   The run specification's "DTOs move to their owning capability"
 *   constraint is therefore only PARTIALLY met this run (the
 *   editor-projection and `PlatformCapabilities` moves); the rest is a
 *   deliberate, recorded deferral, not a completed relocation — see the
 *   capability map for the per-type accounting.
 *
 * Plain request/response DTOs the seam does NOT reference — the ~30 shapes
 * the typed IPC capability modules return (plugin manager, theme manager,
 * style resolver, media panel, problems panel, project classification, …) —
 * live in `./dtos.ts`
 * (untouched by this run; P5c's surface). IPC payload types shared with the
 * Electron host process (and mirrored into `electron/bridge-types.ts`) live
 * in `./shared-types.ts` (also untouched by this run). This file re-exports
 * both so existing `$lib/platform/contract` importers keep resolving.
 */
import type {
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
  CreateProjectOptions,
  AdoptFolderOptions,
  CreateProjectResult,
} from "gutterpress";
// SFE-P3e's `GutterpressProjection` type-import (D6's projection shape) moved
// with `EditorProjectionResult` to `$lib/editor-host/editor-projection-capability`
// (SFE-P5b review round 1) — that module is the one place this file's
// EditorProjection* types now live; see this file's header.
import type { EditorProjectionArgs, EditorProjectionOutcome } from "../editor-host/editor-projection-capability";
// SFE-P5c1: `DirEntry`/`ProjectFileEntry` moved to `$lib/files/files-capability`
// (the module's own DTOs — the run specification's "files/dialog gets a new
// module... DTOs move with their owners out of api.ts") — same type-only
// back-import shape as the editor-projection exception above (module graph
// looks circular, erased at build, so it isn't one at runtime).
import type { DirEntry, ProjectFileEntry } from "../files/files-capability";
import type {
  DiscoveredProject,
  ProjectClassification,
  AppImageIntegrationStatus,
  AppImageIntegrationInstallResult,
  AppImageIntegrationRemoveResult,
  LogFileEntry,
  // SFE-P5c2: project/manifest/tpl/snip/media/plugin/theme/style IPC payload
  // DTOs. These ~13 shapes already lived in `./dtos` (the established home
  // for "plain data shapes the typed IPC capability modules return" — see
  // this file's own header) before this run; ElectronBridge just needs to
  // reference them now that the transport under them is IPC.
  TemplateInfo,
  SavedTemplateInfo,
  SnippetEntry,
  ProjectConfigFields,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectStyle,
  MediaImageEntry,
  MediaImageDetails,
  // SFE-P5c4: recovery/doctor/lint IPC payload DTOs. These already lived in
  // `./dtos` (the established home — see this file's own header) before
  // this run; ElectronBridge just needs to reference them now that the
  // transport under them is IPC.
  RecoveryEntry,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
} from "./dtos";

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
 * Defined here (not `./dtos`) because `ElectronBridge.onFolderChanged`
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

// ── Publishing (#35 / #105) ───────────────────────────────────────────────────
//
// PublishProviderCard/PublishIssue/PublishOutcomeInfo/PublishRunResult are
// imported from shared-types above (re-exported at the top of this file).

/**
 * Static publish-provider metadata (no project needed) — used by Settings →
 * Connections to classify + label stored credentials. Referenced by
 * `ElectronBridge.publish.providers()` directly, so it stays here rather than
 * moving to `$lib/publish/publish-capability` (the same "referenced by
 * ElectronBridge directly" reasoning documented at the top of this file for
 * `FolderRef`/`PreviewStartArgs`/etc.) — no canonical twin in the lib.
 */
export interface PublishProviderStaticInfo {
  id: string;
  label: string;
  kind: "api" | "guided";
  credentialRequired: boolean;
  /** The TokenStore host this provider's credentials are keyed under. */
  credentialHost: string | null;
  tokenUrl: string | null;
  hint: string | null;
  /** #221 — "oauth" = the browser consent flow (gdrive); null/absent = the
   *  existing paste-an-API-key flow. Drives Connections' add-a-key branch. */
  connectKind: "token" | "oauth" | null;
}

// ── Auto-sync orchestrator status (transparent sync, §4.4 integration plan) ──
//
// Defined locally here — decoupled from the lib — so the SPA never
// value-imports the lib (§8 / ADR 0004). Main emits `sync:status` events with
// this payload; the renderer drives the ambient status pill from it. Kept
// alongside `ElectronBridge` (rather than in ./dtos) because `onSyncStatus`
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

/** OS appearance state (#48). Resolved against "system" theme mode. */
export interface NativeThemeState {
  shouldUseDarkColors: boolean;
}

// NOTE (SFE-P5b): the broad `HostServices`/`Platform` service-locator
// interfaces that used to live here are deleted. Every member above the
// `ElectronBridge` type below either moved to a feature-owned capability
// module (updater/remote/build-preview/editor-projection/app-lifecycle/theme
// — see this file's header) or was found dead (zero real desktop consumers)
// and deleted outright:
//
//   - `apiVersion` had no desktop-app reader; the field still exists for
//     real on `window.electron` (electron/types.d.ts), so it stays on
//     `ElectronBridge` below (a type must not lie about the real preload
//     shape), it just has no capability-module wrapper.
//   - `saveSnapshot` was NEVER actually on the preload bridge (compare
//     `electron/types.d.ts`, which has no `saveSnapshot` member) — the real
//     desktop code already called `api.vcs.saveSnapshot(...)` directly
//     (`+page.svelte`). The old `HostServices.saveSnapshot`/
//     `ElectronAdapter.saveSnapshot` forwarding was dead type surface long
//     before this run; deleted here with that search proof.
//   - `openFolder`, `listDir`, `getSecret`, `setSecret` had zero real
//     `getPlatform()`-mediated consumers: every real call site already used
//     `api.dialog.openDirectory()` / `api.fs.listDir()` directly, and
//     `getSecret`/`setSecret` only ever threw ("not implemented yet", #12).
//     Deleted; `readFile`/`writeFile`/`statFile` (EditorBuffer's real fs
//     need) collapsed the same way — EditorBuffer now takes the narrow
//     `EditorBufferFs` shape (`editor/buffer-state.svelte.ts`) satisfied
//     directly by `api.fs`, since the old Platform-level readFile/writeFile/
//     statFile forwarding added no logic of its own over `api.fs.*`.
//   - `capabilities()` moved to `$lib/export/build-preview-capability`'s
//     `getPlatformCapabilities()` — a local synthesis, not a bridge call.

/**
 * The raw `window.electron` bridge shape exposed by `electron/preload.ts`.
 * ONLY `bridge.ts` (and the `Window` global) should reference this —
 * everything else goes through a capability module.
 */
export interface ElectronBridge {
  /** Integer IPC-surface version; mirrors DESKTOP_API in electron/preload.ts. */
  readonly apiVersion: number;
  /**
   * SFE-P5c4: getStatus/check/download rejoined applyNow (quit + install, a
   * live-BrowserWindow flush) and the onEvent push subscription on typed
   * IPC — the full `UpdaterApi` shape, collapsing ARCH review #8's
   * HTTP+IPC fan-out to one transport.
   */
  updater: UpdaterApi;

  // Native (OS) theme (#48) — push channel (main→renderer push, not request/reply)
  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void;

  /**
   * Subscribe to `.md` launches from the desktop shell. Initial paths are
   * replayed before a `ready` sentinel; later Finder/Explorer launches stream
   * through the same callback.
   */
  onOpenMarkdownFile(cb: (event: MarkdownFileLaunchEvent) => void): () => void;

  /**
   * Raw folder-watch IPC (#44). Subscribes to change events for `path` and
   * returns an unsubscribe fn.
   */
  watchFolder(path: string, cb: () => void): () => void;

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

  // ── Google Drive publish connect (#221, docs/gdrive-publish-plan.md D10) ──
  // Same two-phase shape as the GitHub trio above, mirrored deliberately (the
  // recorded alternative — a route trio on the publish hooks bridge — was
  // passed over so the app keeps ONE pattern for interactive OAuth connects).
  // There is no user code to display: `connectGoogleStart` resolves with the
  // auth URL the browser was (or should be) sent to, for a "didn't open?
  // click here" fallback link. Reached from the SPA through
  // `$lib/publish/publish-capability.ts`.

  /** Begin the Google Drive OAuth connect flow; resolves with the auth URL to
   *  offer as a fallback link. An optional `account` label connects a NAMED
   *  credential (mirrors the publish token-paste flow's account label). */
  connectGoogleStart(account?: string): Promise<GoogleConnectStartResult>;
  /** Await user approval of the in-flight connect (the credential is stored
   *  by the host — the renderer only ever sees this redacted result). */
  connectGoogleWait(): Promise<GoogleConnectResult>;
  /** Cancel an in-flight connect attempt (user closed the dialog). */
  connectGoogleCancel(): Promise<{ ok: boolean }>;

  /** Subscribe to clone progress events. Returns an unsubscribe fn. (`cloneRemoteRepository`
   *  itself is the `remote.cloneRepository` member below — SFE-P5c3: restored to IPC.) */
  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ───
  //
  // The host auto-sync orchestrator (electron/main.ts) emits `sync:status`
  // events whenever its state machine transitions. The renderer subscribes here
  // to drive the ambient status pill without polling. (`setAutoSync` itself is
  // the `sync.setAutoSync` member below — SFE-P5c3: restored to IPC.)

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

  // ── Preview / build ────────────────────────────────────────────────────────
  // #49: the IPC layer keeps raw path-string semantics — the capability
  // module (`$lib/export/build-preview-capability`) is the translation seam
  // that unwraps FolderRef.key back into the string `input` the IPC expects.
  startPreview(args: { input: string } & Omit<PreviewStartArgs, "input">): Promise<PreviewStartResult>;
  stopPreview(): Promise<{ stopped: boolean }>;
  cancelExport(exportId: string): Promise<{ canceled: boolean }>;
  build(args: { input: string } & Omit<BuildArgs, "input">): Promise<BuildResult>;

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

  // ── fs / dialog / shell / log / app — typed IPC (SFE-P5c1) ────────────────
  // Replaces the deleted src/routes/api/{fs,dialog,shell,log,app}/**
  // +server.ts routes and their api.ts client methods.

  fs: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<FileWriteResult>;
    statFile(path: string): Promise<FileStat>;
    listDir(path: string): Promise<DirEntry[]>;
    listProjectFiles(projectDir: string): Promise<ProjectFileEntry>;
    createFile(dir: string, name: string, content: string): Promise<{ path: string; mtimeMs: number }>;
    createFolder(dir: string, name: string): Promise<{ path: string }>;
    renamePath(path: string, newName: string): Promise<{ path: string }>;
    deletePath(path: string, projectDir: string): Promise<{ ok: true }>;
  };

  dialog: {
    openDirectory(): Promise<string | null>;
    savePdf(defaultName?: string): Promise<string | null>;
    pickImageFile(): Promise<string | null>;
    pickPdfFile(): Promise<string | null>;
    pickImageFiles(): Promise<string[]>;
  };

  shell: {
    openExternal(url: string): Promise<{ ok: true }>;
    showInFolder(filePath: string): Promise<{ ok: true }>;
  };

  log: {
    read(logPath: string): Promise<string | null>;
    list(): Promise<LogFileEntry[]>;
  };

  app: {
    getDesktopPrefs(): Promise<SharedDesktopPrefs>;
    setDesktopPrefs(prefs: Record<string, unknown>): Promise<{ ok: true }>;
    getDesktopProjectState(projectDir: string): Promise<ProjectState | null>;
    setDesktopProjectState(projectDir: string, state: Record<string, unknown>): Promise<{ ok: true }>;
    getSettings(): Promise<Record<string, unknown>>;
    setSettings(settings: Record<string, unknown>): Promise<{ ok: true }>;
    getNativeTheme(): Promise<NativeThemeState>;
    getRecentFolders(): Promise<Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>>;
    getFavorites(): Promise<Array<{ path: string; title: string; exists: boolean }>>;
    toggleFavorite(path: string, title: string): Promise<{ favorited: boolean }>;
    removeRecent(path: string): Promise<{ ok: true }>;
    discoverProjects(): Promise<DiscoveredProject[]>;
    classifyProject(projectDir: string): Promise<ProjectClassification>;
    createProject(options: Record<string, unknown>): Promise<CreateProjectResult>;
    adoptFolder(options: Record<string, unknown>): Promise<CreateProjectResult>;
    setDirtyState(dirty: boolean): Promise<{ ok: true }>;
    recordFlushFailure(projectDir: string | null): Promise<LastFlushFailure>;
    acknowledgeFlushFailure(failedAt: string): Promise<{ acknowledged: boolean }>;
    appImageIntegration: {
      getStatus(): Promise<AppImageIntegrationStatus>;
      install(): Promise<AppImageIntegrationInstallResult>;
      remove(): Promise<AppImageIntegrationRemoveResult>;
    };
  };

  // ── project / manifest / tpl / snip / media / plugin / theme / vcs /
  // style — typed IPC (SFE-P5c2) ────────────────────────────────────────
  // Replaces the deleted src/routes/api/{project,manifest,tpl,snip,media,
  // plugin,theme,vcs,style}/** +server.ts routes and their api.ts client
  // methods. checkCss / lintProject moved to typed IPC too, but in SFE-P5c4
  // — see the `lint` member further below.

  project: {
    listStyles(projectDir: string, repoRoot?: string | null): Promise<ProjectStyle[]>;
  };

  manifest: {
    read(projectDir: string): Promise<ProjectConfigFields>;
    setFields(projectDir: string, updates: ProjectConfigFields): Promise<ProjectConfigFields>;
  };

  tpl: {
    listBuiltIn(): Promise<TemplateInfo[]>;
    listCustom(): Promise<TemplateInfo[]>;
    saveAsTemplate(opts: {
      projectDir: string;
      name: string;
      sharedRefs?: "vendor" | "exclude";
    }): Promise<SavedTemplateInfo>;
    importFromFolder(): Promise<TemplateInfo | null>;
  };

  snip: {
    list(projectDir: string): Promise<SnippetEntry[]>;
    read(projectDir: string, fileName: string): Promise<string>;
    save(projectDir: string, name: string, body: string): Promise<SnippetEntry>;
    delete(projectDir: string, fileName: string): Promise<{ ok: boolean }>;
  };

  media: {
    listImages(projectDir: string): Promise<MediaImageEntry[]>;
    thumbnail(imagePath: string): Promise<string | null>;
    inspect(imagePath: string): Promise<MediaImageDetails | null>;
    importImage(projectDir: string, src: string): Promise<{ src: string; copied: boolean }>;
  };

  plugin: {
    list(projectDir: string): Promise<ProjectPluginEntry[]>;
    setEnabled(projectDir: string, ref: string, enabled: boolean): Promise<{ ok: boolean }>;
    addNpm(projectDir: string, packageName: string, exportName?: string): Promise<ProjectPluginEntry | null>;
    addLocal(projectDir: string): Promise<ProjectPluginEntry | null>;
    validate(projectDir: string): Promise<PluginValidationResult[]>;
    recommended(): Promise<RecommendedPlugin[]>;
  };

  theme: {
    listBuiltIn(): Promise<ThemeInfo[]>;
    listProject(projectDir: string): Promise<ThemeInfo[]>;
    getActive(projectDir: string): Promise<ThemeInfo | null>;
    apply(projectDir: string, target: ApplyThemeTarget): Promise<ThemeInfo>;
    importFromFolder(projectDir: string): Promise<ThemeInfo | null>;
    importFromFile(projectDir: string): Promise<ThemeImportResult | null>;
    importFromUrl(projectDir: string, url: string): Promise<ThemeInfo>;
    readCss(projectDir: string | null, source: { kind: "builtin" | "project"; id: string }): Promise<string>;
    remove(projectDir: string, id: string): Promise<{ ok: true }>;
    getPrevious(projectDir: string): Promise<ThemeInfo | null>;
    revert(projectDir: string): Promise<ThemeInfo>;
  };

  vcs: {
    enableVersionHistory(projectDir: string): Promise<unknown>;
    listSnapshotsPage(
      projectDir: string,
      options?: { limit?: number; before?: string },
    ): Promise<SnapshotPage>;
    restoreSnapshot(projectDir: string, id: string): Promise<RestoreVersionResult>;
    saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry>;
  };

  style: {
    setActive(projectDir: string, paths: string[]): Promise<string[]>;
  };

  // ── recovery / doctor / lint — typed IPC (SFE-P5c4, the LAST route
  // group) ───────────────────────────────────────────────────────────────
  // Replaces the deleted src/routes/api/{recovery,doctor,lint}/**
  // +server.ts routes and their api.ts client methods.

  recovery: {
    write(filePath: string, content: string, baseMtimeMs: number): Promise<{ ok: boolean }>;
    clear(filePath: string): Promise<{ ok: boolean }>;
    list(projectDir: string): Promise<RecoveryEntry[]>;
  };

  doctor: {
    getDiagnostics(): Promise<DoctorDiagnostics>;
  };

  lint: {
    checkCss(cssPath: string, content: string): Promise<PrintSafeWarning[]>;
    project(projectDir: string): Promise<ProblemEntry[]>;
  };

  // ── remote / sync / publish — typed IPC (SFE-P5c3, the credentials-
  // sensitive group) ────────────────────────────────────────────────────────
  // Replaces the deleted src/routes/api/{remote,sync,publish}/** +server.ts
  // routes and their api.ts client methods. connectGitHubStart/Wait/Cancel/
  // onCloneProgress/onSyncStatus (above) are unchanged by this run.

  remote: {
    disconnectGitHub(): Promise<{ ok: boolean }>;
    getConnection(host?: string): Promise<{ connected: boolean; username?: string; label?: string }>;
    listRepositories(): Promise<RemoteRepository[]>;
    listBranches(owner: string, repo: string): Promise<RemoteBranch[]>;
    listRepoBooks(owner: string, repo: string, branch: string): Promise<RepoBook[]>;
    diagnoseProject(projectDir: string): Promise<SharedProjectRemoteDiagnosis>;
    testRemoteAccess(url: string): Promise<RemoteAccessResult>;
    connectGenericHost(
      args: ConnectGenericHostArgs,
    ): Promise<{ connected: boolean; host: string; username?: string }>;
    disconnectHost(host: string): Promise<{ ok: boolean }>;
    listConnections(): Promise<HostConnectionInfo[]>;
    forgeTokenUrl(host: string): Promise<string | null>;
    sync(projectDir: string, message?: string): Promise<SyncOutcome>;
    cloneRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
  };

  sync: {
    setAutoSync(enabled: boolean): Promise<{ ok: boolean; autoSync: boolean }>;
    /**
     * The last sync status the host emitted for a project, or null. Typed
     * loosely at this raw-bridge layer (same documented drift `onSyncStatus`
     * already carries, capability-map.md §"ElectronBridge parity") — the
     * capability module casts to {@link SyncStatus}.
     */
    getStatus(projectDir: string): Promise<object | null>;
  };

  publish: {
    listProviders(projectDir: string): Promise<PublishProviderCard[]>;
    providers(): Promise<PublishProviderStaticInfo[]>;
    connect(
      projectDir: string,
      providerId: string,
      token: string,
      account?: string,
    ): Promise<{ connected: boolean; providerId: string }>;
    disconnect(providerId: string, account?: string): Promise<{ ok: boolean }>;
    setConfig(
      projectDir: string,
      providerId: string,
      values: Record<string, string>,
    ): Promise<Record<string, Record<string, unknown>>>;
    /**
     * Typed loosely at this raw-bridge layer (same documented reason
     * `sync.getStatus` is): `PreflightRow` lives in `$lib/preflight.ts`,
     * which itself imports `$lib/problems.ts` via the `$lib` alias — a
     * specifier `tsc -p electron/tsconfig.json` cannot resolve (no `$lib`
     * alias configured there; see `files-capability.ts`'s header for the
     * same landmine). Importing that chain into `contract.ts` would pull it
     * into the electron program via `persistence-failures.ts`. The
     * `publish-capability.ts` module (never reached by that program) casts
     * to {@link PreflightRow} for its own typed `preflight()` export.
     */
    preflight(projectDir: string, providerIds: string[]): Promise<unknown[]>;
    run(
      projectDir: string,
      providerId: string,
      options?: { dryRun?: boolean; artifactPath?: string },
    ): Promise<PublishRunResult>;
    /**
     * Existing places a provider can publish into (#221 D9, gdrive: Drive
     * folders) — provider-neutral; the wizard only calls this when the
     * provider's card carries `destinations` (see `listProviders`).
     */
    listDestinations(projectDir: string, providerId: string): Promise<PublishDestination[]>;
    /** Create a new destination (gdrive: a Drive folder at My Drive root). */
    createDestination(projectDir: string, providerId: string, name: string): Promise<PublishDestination>;
  };
}
