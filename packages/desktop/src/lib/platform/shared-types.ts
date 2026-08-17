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
 *   - Used by `electron/bridge-types.ts` (host side) and, for most types,
 *     `src/lib/platform/contract.ts` (renderer side).
 *
 * When you add a new IPC payload type, add it here first, then re-export it
 * in `bridge-types.ts` and consume it in `contract.ts`. No more "Keep them
 * in sync manually" comments.
 *
 * CAVEAT (audit D8): `ProjectSource` and `ProjectCapabilities` are the two
 * exceptions — `contract.ts` type-imports those straight from
 * `gutterpress`, NOT from this mirror, so for those two shapes the lib
 * IS the source of truth and the copy below merely shadows it for the host/
 * bridge path. `shared-types.type-test.ts` fails `svelte-check` if the mirror
 * and the lib ever drift apart, so this duplication can't rot silently.
 */

// ── Desktop updates (electron-updater + macOS check-only notification) ────

/**
 * Which release stream electron-updater checks follow. Channels are inclusive
 * downward: "beta" also receives stable releases, "alpha" receives all three.
 * Release tags carry the channel (`vX.Y.Z-beta.N` / `vX.Y.Z-alpha.N`; no
 * suffix = stable) — the ONLY prerelease suffixes the release workflow
 * accepts, because electron-updater hardcodes alpha/beta as its known
 * channels and treats anything else (e.g. `rc`) as a custom channel that
 * strands its users. Unsigned macOS builds apply the same filtering to the
 * GitHub releases API, then open the selected release for manual installation.
 */
export type UpdateChannel = "stable" | "beta" | "alpha";
export type UpdaterAvailableAction = "download" | "open-release";

export interface UpdaterStatus {
  currentVersion: string | null;
  /** Version downloaded and ready to install on restart. */
  stagedVersion: string | null;
  /** Version found by the last check but not yet downloaded (awaiting user consent). */
  availableVersion: string | null;
  /** What the available-update button does on this host. */
  availableAction: UpdaterAvailableAction | null;
  phase: "idle" | "checking" | "available" | "downloading" | "staged" | "error";
  error: string | null;
}

export type UpdaterEventPayload =
  | { type: "available"; version: string; action: UpdaterAvailableAction }
  | { type: "staged"; version: string }
  | { type: "uptodate"; reason?: string }
  | { type: "error"; message: string };

// ── Project source classification (#12) ───────────────────────────────────
//
// Mirrors gutterpress — defined locally so the SPA never
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
  // Deliberately NO canSync — syncability is credential-aware and answered
  // ONLY by diagnoseProjectRemote().canSync (cached renderer-side as the
  // SyncController's syncDiag). The old capability-level canSync (= hasRemote,
  // any protocol, no credential check) was a second, weaker gate with the same
  // name, and the divergence produced contradictory sync UI. Remote PRESENCE
  // for display lives on `source.hasRemote`.
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
    /**
     * Which editing surface a markdown file opens in.
     *
     * `rich` is the WYSIWYG surface — the author's text at print size, using
     * the book's own stylesheet. `source` is the markdown editor. Both are
     * first-class: markdown is the only thing on disk and hand-editing it is a
     * supported story, and `source` is also where a file lands when the
     * document model cannot represent it (footnotes, plugin syntax), with the
     * reason shown.
     *
     * Default `rich` — the editor is the core of the UI product. Saving in
     * rich mode rewrites the file canonically, which is why the app offers a
     * one-time project normalize before that first save.
     */
    mode: "rich" | "source";
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
    /**
     * Durable editor/preview split fraction (0.25..0.75, editor share) for the
     * wide side-by-side layout (#103). The always-read default; the per-project
     * `ProjectState.splitPaneRatio` snapshot overrides it at project-open, same
     * as `viewMode` relates to `ProjectState.viewMode` below.
     */
    splitRatio: number;
    /**
     * Right-click (or Shift+F10) context menu over the paginated preview
     * (inline-editing plan §4.5). Default true — an explicit-invocation
     * affordance, not seamless WYSIWYG, so the UX contract's opt-in rule for
     * the latter does not apply here.
     */
    contextMenu: boolean;
  };
  updates: {
    /** Release stream for desktop update checks (see UpdateChannel above). */
    channel: UpdateChannel;
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
    /** Optional commit author name. Empty means use existing repo config, then Gutterpress default. */
    authorName: string;
    /** Optional commit author email. Empty means use existing repo config, then Gutterpress default. */
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
    autoSaveDelay: 500,
    crashRecovery: true,
    mode: "rich",
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
    // Matches DEFAULT_SPLIT_RATIO in src/lib/editor/preview-layout.ts so the
    // durable default and the double-click reset target agree (#103).
    splitRatio: 0.42,
    contextMenu: true,
  },
  updates: {
    channel: "stable",
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
  /**
   * When this project's markdown was normalized for rich editing (ISO 8601).
   *
   * Rich editing saves canonically, so the first save on an un-normalized
   * project reformats that file. The app offers to normalize the whole project
   * once instead, and records it here so the offer is not repeated. Per
   * project, because normalization is a property of a book's files.
   */
  normalizedAt?: string;
}

// ── Desktop preferences ────────────────────────────────────────────────────

/** Durable signal that the most recent editor-buffer flush did not complete. */
export interface LastFlushFailure {
  failedAt: string;
  /** Desktop project path, omitted only when the host no longer has project context. */
  projectDir?: string;
}

export interface DesktopPrefs {
  lastProjectDir?: string | null;
  /**
   * Show the start screen (welcome landing) at launch. Default true; when
   * false the app opens straight into the last book behind the splash (the
   * pre-landing behavior). Toggled from the start screen's own checkbox.
   */
  showLandingAtStartup?: boolean;
  /**
   * Parent folder the writer last chose in the "Create a new book" wizard
   * (M21) — read/written as a shallow-merge patch key, so it needs no
   * dedicated route (`NewProjectWizard.svelte`'s `loadDefaultParentDir`).
   */
  newProjectParentDir?: string;
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
  /** Cleared after the next launch has surfaced the failed-flush notice. */
  lastFlushFailed?: LastFlushFailure;
}

/** Persisted state of the global left panel (open + active tab). */
export interface LeftPanelPrefs {
  open?: boolean;
  activeTab?: "toc" | "files" | "media" | "projects" | "history";
  /** Panel width in px (user-resizable, clamped 200–480). */
  width?: number;
}

// ── OS file-open events ───────────────────────────────────────────────────

/**
 * A Markdown file launch resolved by the Electron host. The host walks upward
 * from the selected file and emits `open` only when it finds a real Gutterpress
 * manifest; arbitrary Markdown files are reported without being treated as
 * loose-folder projects. `ready` terminates the initial queued-event replay so
 * startup can safely fall back to reopening the previous project.
 */
export type MarkdownFileLaunchEvent =
  | { type: "open"; filePath: string; projectDir: string }
  | { type: "error"; filePath: string; message: string }
  | { type: "ready" };

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

/** One Gutterpress book found inside a repository (Choose-a-book step). */
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
      reason:
        | "auth"
        | "not-found"
        | "unreachable"
        | "ssh-unsupported"
        | "insecure-transport"
        | "tls"
        | "unknown";
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

// ── Sync (#15 sync phase, ADR 0006 D5; converge ruling 2026-08-14) ───────
//
// Mirrors the lib's sync types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004). Sync ALWAYS converges: there is no
// "conflict" arm, no per-file choices, and no resolve call. Overlapping text
// edits land in the file inside standard git conflict markers
// (`combinedFiles`); clashing binaries keep the newer side (`imageClashes`
// for images); the other version is always reachable in history.

/**
 * One image file that changed on both sides. Sync already converged (the
 * NEWER side's bytes are committed — the safe default); this record drives
 * the non-blocking side-by-side picker. Both blob oids are pinned by the
 * merge commit's parents, so the picker can never go stale.
 */
export interface ImageClash {
  /** Repo-relative path of the image. */
  path: string;
  /** Blob oid of the local version. */
  localOid: string;
  /** Blob oid of the online version. */
  remoteOid: string;
  /** Which side the automatic newer-wins policy kept on disk. */
  kept: "local" | "online";
}

/** Outcome of a sync attempt. */
export type SyncOutcome =
  | {
      status: "synced";
      message: string;
      snapshotId?: string;
      mergedRemoteChanges: boolean;
      filesChanged?: boolean;
      /** Files whose text now holds BOTH versions inside git conflict markers. */
      combinedFiles?: string[];
      /** Clashing images (newer kept) for the non-blocking picker. */
      imageClashes?: ImageClash[];
    }
  | { status: "up-to-date"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "auth"; message: string; snapshotId?: string; filesChanged?: boolean }
  | { status: "offline"; message: string; snapshotId?: string; filesChanged?: boolean }
  | {
      status: "error";
      message: string;
      /**
       * Stable machine-readable signal so the UI can route without matching
       * against `message` text — mirrors the lib's SyncOutcome:
       * "needs-connection-setup" — the project isn't set up right (no online
       * address / SSH address / no named version line); route to the
       * connect/setup surface.
       */
      code?: "needs-connection-setup";
      snapshotId?: string;
      filesChanged?: boolean;
    };

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
  /** True when the stored ciphertext no longer decrypts (OS keyring changed):
   *  the entry LOOKS connected but sync/publish see no credential. The UI
   *  presents it as "needs reconnecting". */
  unreadable?: boolean;
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
  /** Redacted — a usable credential exists (env var or stored key) for the
   *  effective selected account. */
  connected: boolean;
  /** The provider's non-secret manifest `publish.<id>` settings. */
  config: Record<string, string>;
  /**
   * Saved credentials for this provider (redacted — never tokens), so the UI
   * can offer a picker: the default (unnamed, `account:""`) plus any named
   * accounts. Reused across every project since the store is user-scoped.
   */
  savedAccounts: PublishSavedAccountInfo[];
  /**
   * The account label this book currently uses (manifest `publish.<id>.
   * credential`), or "" for the default credential. Empty when unset.
   */
  selectedAccount: string;
}

/** A saved publishing credential, redacted (no token) — for the picker. */
export interface PublishSavedAccountInfo {
  /** Account label; "" is the default (unnamed) credential. */
  account: string;
  /** Display name. */
  label: string;
  createdAt: number;
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

export interface PreviewStartSuccess {
  previewStarted: true;
  url: string;
  port: number;
  input: string;
  title: string | null;
  /**
   * The engine actually rendering this preview. Paged.js has been removed
   * (native-only-migration-plan.md Phase 6) — always "native" now; the field
   * is kept for wire-compatibility with `"paged"` responses from an
   * un-upgraded host.
   */
  engine: "paged" | "native";
}

export interface PreviewStartFailure {
  previewStarted: false;
  input: string;
  title: string | null;
  /** Actionable preview-generation failure; the folder itself is still open. */
  error: string;
}

export type PreviewStartResult = PreviewStartSuccess | PreviewStartFailure;

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
  /**
   * Print-quality findings the render produced (native engine only). Defined
   * locally, decoupled from the lib (§8) — the renderer never value-imports
   * `gutterpress`. Maps into the Problems panel.
   */
  diagnostics?: BuildDiagnosticDto[];
}

/** One print-quality finding, mirrored from the lib's `BuildDiagnostic`. */
export interface BuildDiagnosticDto {
  /** Stable check id, e.g. "engine.multicol.dead-column". */
  code: string;
  severity: "warning" | "info";
  message: string;
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
