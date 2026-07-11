/**
 * Shared IPC payload types — the single source of truth for every interface
 * that must be consistent across the Electron host and the SvelteKit renderer.
 *
 * RULES for this file:
 *   - Pure type/interface/type-alias declarations ONLY, with ONE narrow
 *     exception: a shared VALUE is allowed here when (a) it is a plain,
 *     side-effect-free data literal (no functions, no `node:*`/electron/lib
 *     imports — §8-safe to pull into the renderer bundle) and (b) both sides
 *     need the exact same value and would otherwise hand-duplicate it (e.g.
 *     `DEFAULT_SETTINGS` below). No imports, still, ever.
 *   - All types must be self-contained (no references to external modules).
 *   - Used by BOTH `electron/bridge-types.ts` (host side) and
 *     `src/lib/platform/contract.ts` (renderer side).
 *
 * When you add a new IPC payload type, add it here first, then re-export it
 * in `bridge-types.ts` and consume it in `contract.ts`. No more "Keep them
 * in sync manually" comments.
 */

// ── Auto-update (electron-updater — full-app updates from GitHub) ─────────

export interface UpdaterStatus {
  currentVersion: string | null;
  /** Version downloaded and ready to install on restart. */
  stagedVersion: string | null;
  /** Version found by the last check but not yet downloaded (awaiting user consent). */
  availableVersion: string | null;
  phase: "idle" | "checking" | "available" | "downloading" | "staged" | "error";
  error: string | null;
}

export type UpdaterEventPayload =
  | { type: "available"; version: string }
  | { type: "staged"; version: string }
  | { type: "uptodate"; reason?: string }
  | { type: "error"; message: string };

// ── Project source classification (#12) ───────────────────────────────────
//
// Mirrors @dimm-city/print-md — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004).

export type ProjectSource =
  | { type: "local-folder"; path: string }
  | {
      type: "local-git-folder";
      path: string;
      /** Repository root holding the history (equals `path` for repo roots). */
      repoRoot: string;
      /** Project dir relative to repoRoot, "/"-separated; "" at the root. */
      subPath: string;
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      owner: string;
      repo: string;
      branch: string;
      rootPath?: string;
    };

export interface ProjectCapabilities {
  canRead: boolean;
  canWriteLocal: boolean;
  canEnableVersionHistory: boolean;
  canSnapshot: boolean;
  canViewHistory: boolean;
  canRestoreSnapshot: boolean;
  canSync: boolean;
  authManagedByApp: boolean;
}

// ── User settings (#45) ───────────────────────────────────────────────────

export interface AppSettings {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    spellCheckLanguage: string;
    autoSaveDelay: number;
    /** Write crash-recovery sidecar snapshots while editing (#44). */
    crashRecovery: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    previewBg: string;
  };
  preview: {
    defaultZoom: string;
    viewMode: "single" | "two-column";
    /**
     * On small/narrow viewports the editor and preview can't sit side by side,
     * so the workspace collapses to a single pane and this picks which one is
     * shown. Ignored above the responsive breakpoint (split layout). (#responsive)
     */
    paneMode: "edit" | "view";
  };
  versionHistory: {
    /**
     * Save automatic snapshots while the author works (RC1-3): the host arms a
     * quiet-period timer on every save and snapshots when edits settle, plus on
     * project close / app quit. Only for projects that already have version
     * history — a plain folder is never auto-initialised. Default ON.
     */
    autoSnapshot: boolean;
    /** Minutes of quiet after the last edit before a snapshot fires (floor 5). */
    autoSnapshotMinutes: number;
    /**
     * Automatically sync to the remote in the background when a remote is
     * configured (transparent-sync plan §6). Defaults ON for projects with
     * canSync; local-only projects are never auto-synced regardless of this
     * setting.
     */
    autoSync: boolean;
    /** Periodic safety-sync cadence in minutes (clamped to [1, 1440]). */
    autoSyncMinutes: number;
  };
  gitIdentity: {
    /** Optional commit author name. Empty means use existing repo config, then print-md default. */
    authorName: string;
    /** Optional commit author email. Empty means use existing repo config, then print-md default. */
    authorEmail: string;
  };
  advanced: {
    fileWatcherInterval: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

/**
 * Canonical settings defaults (#29/#45) — the ONE copy. Previously hand-
 * duplicated between `electron/settings-store.ts` and
 * `src/lib/platform/contract.ts` with "kept in sync manually" comments; both
 * now import this value (contract.ts directly, settings-store.ts via
 * `bridge-types.ts`'s value re-export) instead of redeclaring it.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    lineHeight: 1.6,
    spellCheckLanguage: "en-US",
    autoSaveDelay: 2500,
    crashRecovery: true,
  },
  appearance: {
    theme: "system",
    previewBg: "#5a5a5a",
  },
  preview: {
    defaultZoom: "fit-width",
    // Durable default view mode (settings-store.ts's readSettings() default).
    // See ProjectState.viewMode below for the per-project override that
    // takes precedence over this at project-open time.
    viewMode: "two-column",
    paneMode: "view",
  },
  versionHistory: {
    autoSnapshot: true,
    autoSnapshotMinutes: 10,
    autoSync: true, // transparent-sync plan §6: ON by default when canSync
    autoSyncMinutes: 2, // ~2 min periodic safety cadence
  },
  gitIdentity: {
    authorName: "",
    authorEmail: "",
  },
  advanced: {
    fileWatcherInterval: 300,
    logLevel: "warn",
  },
};

/** A recursively-optional view of `T` — used for settings patches. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Convenience alias for AppSettings patches. */
export type DeepPartialSettings = DeepPartial<AppSettings>;

// ── Per-project editor/preview state (#43) ────────────────────────────────

/**
 * `currentPage`, `viewMode`, and `splitPaneRatio` are the live fields (#30
 * removed `lastChapter`/`sidebarOpen`/`cursorLine`/`editorScroll` — declared
 * for a forthcoming in-app editor/chapter-list that never consumed them, so
 * they carried through JSON as permanently-unread dead schema).
 *
 * `viewMode` here is a per-project SNAPSHOT, not the live value the UI reads:
 * `AppSettings.preview.viewMode` (shared-types.ts above) is the durable
 * default the UI reads/writes at all times; this snapshot is applied ONLY
 * when a project is opened, overriding the durable value with that project's
 * last-used mode so reopening a folder restores its own layout (see
 * `ZoomViewController.applyViewMode`'s doc comment in the SPA, and
 * `+page.svelte`'s restore-on-open flow). AppSettings wins everywhere else.
 */
export interface ProjectState {
  currentPage?: number;
  viewMode?: "single" | "two-column";
  splitPaneRatio?: number;
}

// ── Viewer preferences ────────────────────────────────────────────────────

export interface ViewerPrefs {
  lastProjectDir?: string | null;
  /** Chapter-list sidebar open/closed, persisted across sessions (#42). */
  sidebarOpen?: boolean;
  recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
  favorites?: Array<{ path: string; title: string }>;
  /** Per-project editor/preview state keyed by folder path (#43). */
  projectStates?: Record<string, ProjectState>;
  /**
   * Root directories scanned by `discoverProjects()` (#27). Defaults to
   * `[~/Documents, ~/Desktop]` in the main process when unset.
   */
  projectSearchRoots?: string[];
  /**
   * Last classified source of the open project (#12). A cached hint only — the
   * app always re-classifies on folder open (a user may add/remove `.git`
   * between sessions), so this never overrides a fresh detection.
   */
  projectSource?: ProjectSource;
  /** Global left panel open state + active tab, persisted across sessions. */
  leftPanel?: LeftPanelPrefs;
}

/** Persisted state of the global left panel (open + active tab). */
export interface LeftPanelPrefs {
  open?: boolean;
  activeTab?: "toc" | "files" | "media" | "projects" | "history";
  /** Panel width in px (user-resizable, clamped 200–480). */
  width?: number;
}

// ── Managed GitHub integration (#15, ADR 0006) ────────────────────────────
//
// Mirrors the lib's remote-auth types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004). Tokens NEVER reach the renderer.

/** What the UI shows during the GitHub device flow (code + where to enter it). */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Redacted connection status for a remote host — never carries the token. */
export interface RemoteConnection {
  connected: boolean;
  username?: string;
  label?: string;
}

/** One repository the user can open from GitHub. */
export interface RemoteRepository {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

/** One branch of a remote repository. */
export interface RemoteBranch {
  name: string;
}

/** One print-md book found inside a repository (Choose-a-book step). */
export interface RepoBook {
  /** Book folder relative to the repo root ("" = the root itself). */
  path: string;
  /** Display name (folder basename; the repo name for the root). */
  name: string;
}

/** Coarse clone progress pushed from the host while a project downloads. */
export interface CloneProgressEvent {
  phase: string;
  loaded: number;
  total?: number;
}

/** Inputs for cloning a repository into a new local project folder. */
export interface CloneRepositoryArgs {
  url: string;
  parentDir: string;
  folderName: string;
  branch?: string;
  owner?: string;
  repo?: string;
  /**
   * Book subfolder to open after the clone (repo-relative, "/"-separated).
   * Empty/absent opens the repository root.
   */
  subPath?: string;
}

// ── Advanced Setup (#14, ADR 0006 D3/D7) ─────────────────────────────────

/** Outcome of the explicit "Test Remote Access" probe (a refs listing). */
export type RemoteAccessResult =
  | { ok: true; defaultBranch?: string; refCount: number }
  | {
      ok: false;
      reason: "auth" | "not-found" | "unreachable" | "ssh-unsupported" | "tls" | "unknown";
      message: string;
    };

/** Environment status for the Advanced Setup panel. */
export interface ProjectRemoteDiagnosis {
  classification: ProjectSource;
  /** Sanitized remote URL (no embedded credentials), when one exists. */
  remoteUrl?: string;
  remoteHost?: string;
  remoteProtocol: "https" | "ssh" | "none";
  branch?: string;
  /** A credential for `remoteHost` is stored on this computer. */
  credentialPresent: boolean;
  provider:
    | "github"
    | "gitea"
    | "forgejo"
    | "gitlab"
    | "bitbucket"
    | "azure"
    | "generic"
    | null;
  tokenSettingsUrl: string | null;
  canSync: boolean;
  guidance:
    | "local-only"
    | "connect-github-to-sync"
    | "https-connect-server"
    | "ready-to-sync"
    | "ssh-use-own-tools";
}

// ── Sync (#15 sync phase, ADR 0006 D5) ───────────────────────────────────
//
// Mirrors the lib's sync types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004).

/** How one conflicted file differs between the two copies. */
export type ConflictKind = "both-edited" | "you-deleted" | "online-deleted";

/** One file that changed in both the local and the online copy. */
export interface ConflictFileInfo {
  path: string;
  kind: ConflictKind;
}

/** The author's per-file decision (Keep mine / Use online / Keep both). */
export interface ConflictResolutionChoice {
  path: string;
  choice: "mine" | "theirs" | "both";
}

/** Outcome of a sync (or conflict-resolution) attempt. */
export type SyncOutcome =
  | {
      status: "synced";
      message: string;
      snapshotId?: string;
      mergedRemoteChanges: boolean;
      filesChanged?: boolean;
    }
  | { status: "up-to-date"; message: string; snapshotId?: string; filesChanged?: boolean }
  | {
      status: "conflict";
      message: string;
      files: ConflictFileInfo[];
      localId: string;
      remoteId: string;
      snapshotId?: string;
    }
  | { status: "auth"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "offline"; message: string; snapshotId?: string; filesChanged?: boolean }
  | {
      status: "error";
      message: string;
      /**
       * Stable machine-readable signal for the small set of "the project isn't
       * set up right" failures (no online address / SSH address / no named
       * version line) the lib can identify. Lets the host route to its
       * connect/setup surface without matching against `message` text (which
       * stays free to reword) — mirrors the lib's SyncOutcome (sync-types.ts).
       */
      code?: "needs-connection-setup";
      snapshotId?: string;
      filesChanged?: boolean;
    };

/** Inputs for applying the author's conflict choices. */
export interface ResolveSyncConflictsArgs {
  projectDir: string;
  resolutions: ConflictResolutionChoice[];
  /** Echo of the conflict outcome's `localId`. */
  localId: string;
  /** Echo of the conflict outcome's `remoteId`. */
  remoteId: string;
}

/** Inputs for the generic "Connect a Git server" token flow. */
export interface ConnectGenericHostArgs {
  host: string;
  username?: string;
  token: string;
  /** Optional repository URL to validate against (full probe must succeed). */
  repoUrl?: string;
}

/** Redacted stored-connection entry — never carries tokens. */
export interface HostConnectionInfo {
  host: string;
  kind: "github-oauth" | "token";
  username?: string;
  label?: string;
  createdAt: number;
}

// ── Publish providers (#35) ────────────────────────────────────────────────
//
// Mirrors the lib's publish types — defined locally so the SPA never
// value-imports the lib into the renderer bundle (§8 / ADR 0004).

/** One author-editable settings field a provider declares (data-driven UI). */
export interface PublishConfigFieldInfo {
  key: string;
  label: string;
  placeholder?: string;
}

/** One provider card in the Publish panel — static info + redacted status. */
export interface PublishProviderCard {
  id: string;
  label: string;
  /** "api" = real upload; "guided" = staged package + checklist. */
  kind: "api" | "guided";
  /** Which build output the provider publishes. */
  format: "pdf" | "html";
  description: string;
  /** The provider's declared settings fields — the panel renders these. */
  fields: PublishConfigFieldInfo[];
  credentialRequired: boolean;
  /** Where the author creates the key (deep link for the connect UI). */
  tokenUrl?: string;
  /** Author-facing hint for the connect UI. */
  hint?: string;
  /** Redacted — a usable credential exists (env var or stored key). */
  connected: boolean;
  /** The provider's non-secret manifest `publish.<id>` settings. */
  config: Record<string, string>;
}

/** One publish preflight finding. */
export interface PublishIssue {
  severity: "error" | "warning" | "info";
  id: string;
  message: string;
}

/**
 * What a publish produced (mirrors the lib's PublishOutcome union — the
 * discriminant keeps the panel's rendering type-narrowed, no `!` assertions).
 */
export type PublishOutcomeInfo =
  | {
      kind: "published";
      url?: string;
      detail?: string;
      followUp?: string[];
    }
  | {
      kind: "guided";
      packageDir: string;
      openUrl: string;
      checklist: string[];
      detail?: string;
    };

/** Structured result of a publish run (or dry run). */
export interface PublishRunResult {
  ok: boolean;
  providerId: string;
  issues: PublishIssue[];
  outcome?: PublishOutcomeInfo;
  error?: string;
  /** Progress lines captured during the run (butler/swa output etc.). */
  log?: string[];
}

// ── Local version history (#13) ───────────────────────────────────────────
//
// Mirrors the lib's source-provider types — defined locally so the SPA never
// value-imports the lib (and its isomorphic-git/node deps) into the renderer
// bundle (§8 / ADR 0004).

/** One entry in a project's version history (a Git commit, abstracted). */
export interface SnapshotEntry {
  /** Opaque revision id (a commit SHA for the local provider). */
  id: string;
  /** Author-supplied or auto-generated snapshot message. */
  message: string;
  /** Epoch milliseconds the snapshot was taken. */
  timestamp: number;
  /** Display name recorded for the snapshot author, if any. */
  author?: string;
}

/** One bounded page of version history (mirrors the lib's HistoryPage). */
export interface SnapshotPage {
  entries: SnapshotEntry[];
  /** Older entries exist — pass the last entry's id as `before` to continue. */
  hasMore: boolean;
}

/** Result of a safe restore (#13): backupId is the automatic pre-restore snapshot. */
export interface RestoreVersionResult {
  restoredId: string;
  backupId?: string;
}

// ── Preview / build IPC payloads ──────────────────────────────────────────
//
// Preload-layer versions use raw `string` for `input` (path). The contract
// layer wraps these with FolderRef — see contract.ts for the adapter seam.

export interface RawPreviewStartArgs {
  input: string;
}

export interface PreviewStartResult {
  url: string;
  port: number;
  input: string;
  title: string | null;
  missingSharedAssets?: string[];
}

export interface RawBuildArgs {
  input: string;
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

export interface BuildResult {
  exportId?: string;
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
  downloadUrl?: string;
}

export interface ExportProgressEvent {
  exportId: string;
  state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
  pages?: number;
  message?: string;
}

export interface UrlPreviewBlockedEvent {
  url: string;
  reason: string;
}
