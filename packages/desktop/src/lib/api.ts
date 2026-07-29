/**
 * Typed fetch client for SvelteKit +server.ts API routes.
 *
 * Each method corresponds to a route under src/routes/api/. The platform
 * adapter (getPlatform()) remains in use for push-channel subscriptions and
 * complex orchestration flows (preview, build, vcs, sync, updater) that cannot
 * be expressed as simple request/reply routes.
 *
 * All methods throw on non-OK responses (with the response body as the message).
 */

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || r.statusText);
  }
  return r.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || r.statusText);
  }
  return r.json() as Promise<T>;
}

// ── Contract DTOs — the single source of truth ───────────────────────────────
//
// These were previously RE-DECLARED here, and one copy had already drifted
// (`ProjectRemoteDiagnosis.classification` was `any` instead of the typed
// `ProjectSource`). They are now imported type-only from `./platform/contract`
// (the seam interfaces + IPC-shared types) and `./platform/dtos` (the plain
// request/response DTOs, ARCH review #39/#40), so the api client and the
// host/renderer contract can never disagree again. `import type` is fully
// erased at build, so the SPA still never value-imports the lib (§8 / ADR
// 0004 renderer purity). Re-exported so existing `$lib/api` type consumers
// keep resolving.
export type {
  FileWriteResult,
  FileStat,
  ConflictKind,
  SnapshotEntry,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SyncOutcome,
  PublishProviderCard,
  PublishIssue,
  PublishOutcomeInfo,
  PublishRunResult,
  DesktopPrefs,
  LastFlushFailure,
  ProjectState,
  CreateProjectResult,
} from './platform/contract';

import type {
  FileWriteResult,
  FileStat,
  ConflictKind,
  SnapshotEntry,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SyncOutcome,
  SyncStatus,
  CloneRepositoryArgs,
  ResolveSyncConflictsArgs,
  UpdaterStatus,
  PublishProviderCard,
  PublishRunResult,
  DesktopPrefs,
  LastFlushFailure,
  ProjectState,
  CreateProjectResult,
} from './platform/contract';

export type {
  AppImageIntegrationStatus,
  AppImageIntegrationInstallResult,
  AppImageIntegrationRemoveResult,
  AppImageIntegrationPaths,
  DiscoveredProject,
  PluginKind,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ThemeImportWarning,
  ProjectStyle,
  RecoveryEntry,
  ConflictPreview,
  ProjectClassification,
  MediaImageEntry,
  MediaImageDetails,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
} from './platform/dtos';

import type {
  AppImageIntegrationStatus,
  AppImageIntegrationInstallResult,
  AppImageIntegrationRemoveResult,
  DiscoveredProject,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectStyle,
  RecoveryEntry,
  ConflictPreview,
  ProjectClassification,
  MediaImageEntry,
  MediaImageDetails,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
} from './platform/dtos';

// Publish-preflight row DTO (#105). Pure `$lib` module — type-only here so the
// client bundle still never value-imports it through the api client.
export type { PreflightRow } from './preflight';
import type { PreflightRow } from './preflight';

// ── Genuinely api-local shapes (no canonical twin in the contract) ───────────

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  kind: 'builtin' | 'custom';
  dir?: string;
}

export interface SnippetEntry {
  name: string;
  fileName: string;
  variables: string[];
}

/** Static publish-provider metadata (no project needed) — used by the
 *  Settings → Connections tab to classify + label stored credentials. */
export interface PublishProviderStaticInfo {
  id: string;
  label: string;
  kind: 'api' | 'guided';
  credentialRequired: boolean;
  /** The TokenStore host this provider's credentials are keyed under. */
  credentialHost: string | null;
  tokenUrl: string | null;
  hint: string | null;
}

// ── Project configuration view (#PCV) — author-facing manifest subset ──────
// Declared locally (mirrors the lib's `ProjectConfigFields`) so the SPA bundle
// stays free of value imports from `gutterpress` (§8 renderer purity).

export interface ProjectConfigFields {
  title?: string;
  authors?: string[];
  /** `source.files` — null is the deliberate "all chapter files" sentinel. */
  sourceFiles?: string[] | null;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ProjectFileEntry {
  md: string[];
  css: string[];
}

/** Typed API client for all server routes under src/routes/api/. */
export const api = {
  /** Low-level helpers exposed for direct use when needed. */
  _post: post,
  _get: get,

  dialog: {
    /** Open native directory picker. Resolves null when cancelled. */
    openDirectory: () => post<string | null>('/api/dialog/open-directory'),
    /** Open native PDF save dialog. Resolves null when cancelled. */
    savePdf: (defaultName?: string) =>
      post<string | null>('/api/dialog/save-pdf', defaultName !== undefined ? { defaultName } : {}),
    /** Open native single image file picker. Resolves null when cancelled. */
    pickImageFile: () => post<string | null>('/api/dialog/pick-image-file'),
    /** Native open dialog for the publish artifact (PDF). Null when cancelled. */
    pickPdfFile: () => post<string | null>('/api/dialog/pick-pdf-file'),
    /** Open native multi-select image file picker. Resolves [] when cancelled. */
    pickImageFiles: () => post<string[]>('/api/dialog/pick-image-files'),
  },

  shell: {
    /** Open a URL in the system browser. */
    openExternal: (url: string) => post<{ ok: boolean }>('/api/shell/open-external', { url }),
    /** Reveal a file in the OS file manager. */
    showInFolder: (filePath: string) =>
      post<{ ok: boolean }>('/api/shell/show-in-folder', { filePath }),
  },

  log: {
    /** Read an operation log file. Returns null when the file doesn't exist. */
    read: (logPath: string) => post<string | null>('/api/log/read', { logPath }),
  },

  fs: {
    /** Read a file as UTF-8 text. Path must be absolute. */
    readFile: (filePath: string) => post<string>('/api/fs/read-file', { path: filePath }),
    /**
     * Write UTF-8 content to a file. Path must be absolute. Triggers
     * auto-snapshot/sync debounce if the file is inside the open project.
     * Returns { mtimeMs } of the post-write stat.
     */
    writeFile: (filePath: string, content: string) =>
      post<FileWriteResult>('/api/fs/write-file', { path: filePath, content }),
    /** Stat a file. Returns { exists: false } instead of throwing when absent. */
    statFile: (filePath: string) => post<FileStat>('/api/fs/stat-file', { path: filePath }),
    /** List the immediate entries of a directory. Path must be absolute. */
    listDir: (dirPath: string) => post<DirEntry[]>('/api/fs/list-dir', { path: dirPath }),
    // copyFile wrapper deleted (audit D2) — the SPA's image-insert flow calls
    // api.media.importImage, not this. The /api/fs/copy-file ROUTE is retained
    // deliberately: it still guards the shared picker-capability + fs-guard
    // path and carries that mechanism's security regression tests.
    // watchFolder/unwatchFolder deleted (ARCH review #8) — the folder watch
    // stays IPC-only (preload.ts / electron-adapter.ts); these client
    // wrappers and their /api/fs/{watch,unwatch}-folder routes had zero
    // callers, the IPC path being the live one.
    /**
     * List top-level .md and .css files in a project directory. No SPA caller
     * on the Electron target today (audit D6): retained as staging for the PWA
     * WebAdapter plan's Phase 1 (docs/pwa-webadapter-plan.md lists
     * listProjectFiles), whose WebAdapter.listProjectFiles is the live browser
     * implementation.
     */
    listProjectFiles: (projectDir: string) =>
      post<ProjectFileEntry>('/api/fs/list-project-files', { projectDir }),

    // ── Tree CRUD (UX review M9) ─────────────────────────────────────────
    // `dir` + `name` (not a full path) so path-joining stays host-side —
    // see create-file/+server.ts's header comment.
    /** Create a new file under `dir`. Fails (409) if a file already exists there. */
    createFile: (dir: string, name: string, content = '') =>
      post<{ path: string; mtimeMs: number }>('/api/fs/create-file', { dir, name, content }),
    /** Create a new folder under `dir`. Fails (409) if something already exists there. */
    createFolder: (dir: string, name: string) =>
      post<{ path: string }>('/api/fs/create-folder', { dir, name }),
    /** Rename a file/folder in place (same parent dir, new name). Fails (409) on a name collision. */
    renamePath: (path: string, newName: string) =>
      post<{ path: string }>('/api/fs/rename', { path, newName }),
    /**
     * Delete a file or folder (recursive). When the project has version
     * history the host snapshots the working tree first (best-effort no-op
     * when there's nothing new to save) so the deleted content stays
     * recoverable through Version History; the call rejects WITHOUT
     * deleting if that safety snapshot fails.
     */
    deletePath: (path: string, projectDir: string) =>
      post<{ ok: true }>('/api/fs/delete', { path, projectDir }),
  },

  app: {
    /** Get desktop prefs (lastProjectDir, recentFolders, projectStates, etc.). */
    getDesktopPrefs: () => get<DesktopPrefs>('/api/app/gutterpress-prefs'),
    /** Shallow-merge patch into desktop prefs. */
    setDesktopPrefs: (prefs: Record<string, unknown>) => post<{ ok: boolean }>('/api/app/gutterpress-prefs', prefs),
    /** Get per-project editor/preview state for the given projectDir. */
    getDesktopProjectState: (projectDir: string) =>
      post<ProjectState | null>('/api/app/gutterpress-project-state/get', { projectDir }),
    /** Set per-project editor/preview state for the given projectDir. */
    setDesktopProjectState: (projectDir: string, state: Record<string, unknown>) =>
      post<{ ok: boolean }>('/api/app/gutterpress-project-state/set', { projectDir, state }),
    /** Get app settings (merged with defaults). */
    getSettings: () => get<Record<string, unknown>>('/api/app/settings'),
    /** Deep-merge patch into app settings. */
    setSettings: (settings: Record<string, unknown>) => post<{ ok: boolean }>('/api/app/settings', settings),
    /** Get the OS native dark/light theme preference. */
    getNativeTheme: () => get<{ shouldUseDarkColors: boolean }>('/api/app/native-theme'),
    /** Get the recent folders list (with exists flag). `lastActiveBook` (C2) is
     *  the absolute folder of the book that was active when a repo-backed
     *  entry was recorded — absent for standalone (non-git) entries. */
    getRecentFolders: () =>
      get<Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>>(
        '/api/app/recent-folders',
      ),
    /** Get the favorites list (with exists flag). */
    getFavorites: () => get<Array<{ path: string; title: string; exists: boolean }>>('/api/app/favorites'),
    /** Toggle a folder in the favorites list. */
    toggleFavorite: (path: string, title: string) =>
      post<{ favorited: boolean }>('/api/app/favorites/toggle', { path, title }),
    /** Remove a folder from the recent list. */
    removeRecent: (path: string) => post<{ ok: boolean }>('/api/app/recent/remove', { path }),
    /** Discover Gutterpress projects under the configured search roots. */
    discoverProjects: () => post<DiscoveredProject[]>('/api/app/discover-projects', {}),
    /** Classify a project folder (source type + capabilities + repo book list). */
    classifyProject: (projectDir: string) =>
      post<ProjectClassification>('/api/app/classify-project', { projectDir }),
    /** Scaffold a new project from a template. */
    createProject: (opts: Record<string, unknown>) =>
      post<CreateProjectResult>('/api/app/create-project', opts),
    /** Adopt an existing folder as a Gutterpress project. */
    adoptFolder: (opts: Record<string, unknown>) =>
      post<CreateProjectResult>('/api/app/adopt-folder', opts),
    /** Push a best-effort dirty-state hint; close still requests a direct flush. */
    setDirtyState: (dirty: boolean) => post<{ ok: boolean }>('/api/app/dirty-state', { dirty }),
    /** Persist a failed editor-buffer flush marker in the atomic desktop prefs store. */
    recordFlushFailure: (projectDir: string | null) =>
      post<LastFlushFailure>('/api/app/flush-failure', { action: 'record', projectDir }),
    /** Clear exactly the marker that was surfaced, without racing a newer failure. */
    acknowledgeFlushFailure: (failedAt: string) =>
      post<{ acknowledged: boolean }>('/api/app/flush-failure', { action: 'acknowledge', failedAt }),

    /**
     * Linux AppImage application-menu integration (#119). `status()` is safe to
     * call on every platform — off-Linux, in dev, or outside an AppImage it
     * reports `supported: false` with a reason, and the Settings action stays
     * hidden. Neither action takes a path: the host owns the fixed per-user
     * destinations.
     */
    appImageIntegration: {
      getStatus: () => get<AppImageIntegrationStatus>('/api/app/appimage-integration'),
      install: () =>
        post<AppImageIntegrationInstallResult>('/api/app/appimage-integration', {
          action: 'install',
        }),
      remove: () =>
        post<AppImageIntegrationRemoveResult>('/api/app/appimage-integration', {
          action: 'remove',
        }),
    },
    // flushDone deleted (ARCH review #8) — this wrapper (and the
    // /api/app/flush-done route) had zero callers: the real flush-before-close
    // reply is fired directly over IPC (preload.ts's onFlushBeforeClose calls
    // ipcRenderer.invoke("app:flushDone") — it can't route through fetch, since
    // it must resolve synchronously with the renderer's own close-time flush).
  },

  media: {
    /** List all image files under a project directory (recursive, bounded). */
    listImages: (projectDir: string) =>
      post<MediaImageEntry[]>('/api/media/list-images', { projectDir }),
    /** Generate a small (≤192px) thumbnail data URL for an image. Returns null when unavailable. */
    thumbnail: (imagePath: string, width?: number, height?: number) =>
      post<string | null>('/api/media/thumbnail', { imagePath, width, height }),
    /** Inspect an image file — returns file size + header metadata (dimensions, DPI, alpha, color space). */
    inspect: (imagePath: string) =>
      post<MediaImageDetails | null>('/api/media/inspect', { imagePath }),
    /**
     * Import an author-picked image (absolute path, from anywhere on disk —
     * e.g. a native file dialog) into the given project, returning the
     * project-relative markdown `src` to use. The ONE host-side
     * implementation of the import policy (UX review M10): already-inside
     * the project just computes the relative path; outside the project
     * copies into an existing `images/` dir if present, else `assets/`
     * (created on demand), de-duplicating a colliding basename. Both
     * EditorToolbar and MediaPanel call this — neither does its own path/fs
     * math (CLAUDE.md §8).
     */
    importImage: (projectDir: string, src: string) =>
      post<{ src: string; copied: boolean }>('/api/media/import-image', { projectDir, src }),
  },

  lint: {
    /** Run CSS print-safety lint on the given CSS content. Returns an array of warnings. */
    checkCss: (cssPath: string, content: string) =>
      post<PrintSafeWarning[]>('/api/lint/check-css', { cssPath, content }),
    /** Run project-wide pre-build source lint checks. Returns problem entries for the Problems panel. */
    project: (projectDir: string) =>
      post<ProblemEntry[]>('/api/lint/project', { projectDir }),
  },

  tpl: {
    /** List the built-in starter templates (static metadata). */
    listBuiltIn: () => get<TemplateInfo[]>('/api/tpl/built-in'),
    /** List the user's saved/imported custom templates. */
    listCustom: (templatesRoot?: string) =>
      post<TemplateInfo[]>('/api/tpl/custom', templatesRoot !== undefined ? { templatesRoot } : {}),
    /** Save the open project as a reusable custom template. */
    saveAsTemplate: (opts: unknown) => post<TemplateInfo>('/api/tpl/save-as-template', opts),
    /** Open a native folder picker and import the selected folder as a template. Resolves null when cancelled. */
    importFromFolder: () => post<TemplateInfo | null>('/api/tpl/import-from-folder', {}),
  },

  snip: {
    /** List the open project's snippets. */
    list: (projectDir: string) => post<SnippetEntry[]>('/api/snip/list', { projectDir }),
    /** Read one snippet's raw body. */
    read: (projectDir: string, fileName: string) =>
      post<string>('/api/snip/read', { projectDir, fileName }),
    /** Save a snippet body under the project's snippets/ folder. */
    save: (projectDir: string, name: string, body: string) =>
      post<SnippetEntry>('/api/snip/save', { projectDir, name, body }),
    /** Delete a snippet by filename. */
    delete: (projectDir: string, fileName: string) =>
      post<{ ok: boolean }>('/api/snip/delete', { projectDir, fileName }),
  },

  plugin: {
    /** List the open project's configured plugins. */
    list: (projectDir: string) =>
      post<ProjectPluginEntry[]>('/api/plugin/list', { projectDir }),
    /** Enable or disable a configured plugin by ref. */
    setEnabled: (projectDir: string, ref: string, enabled: boolean) =>
      post<{ ok: boolean }>('/api/plugin/set-enabled', { projectDir, ref, enabled }),
    /** Download, verify, vendor, and pin an npm plugin (built-ins only need configuring). */
    addNpm: (projectDir: string, packageName: string, exportName?: string) =>
      post<ProjectPluginEntry | null>('/api/plugin/add-npm', {
        projectDir,
        packageName,
        ...(exportName ? { exportName } : {}),
      }),
    /** Open a native file picker and import the chosen file/folder as a local plugin. Resolves null when cancelled. */
    addLocal: (projectDir: string) =>
      post<ProjectPluginEntry | null>('/api/plugin/add-local', { projectDir }),
    /** Load-test every configured plugin; reports ok/error per entry. */
    validate: (projectDir: string) =>
      post<PluginValidationResult[]>('/api/plugin/validate', { projectDir }),
    /** Get the curated list of recommended plugins (static, no projectDir needed). */
    recommended: () => get<RecommendedPlugin[]>('/api/plugin/recommended'),
  },

  theme: {
    /** List all built-in themes (static metadata). */
    listBuiltIn: () => get<ThemeInfo[]>('/api/theme/built-in'),
    /** List themes already imported into the project. */
    listProject: (projectDir: string) =>
      post<ThemeInfo[]>('/api/theme/project', { projectDir }),
    /** Get the currently active theme for the project. Returns null when none applied. */
    getActive: (projectDir: string) =>
      post<ThemeInfo | null>('/api/theme/active', { projectDir }),
    /** Apply a built-in or project theme. Copies files and wires the manifest. */
    apply: (projectDir: string, target: ApplyThemeTarget) =>
      post<ThemeInfo>('/api/theme/apply', { projectDir, target }),
    /** Open a native folder picker and import the selected folder as a theme. Resolves null when cancelled. */
    importFromFolder: (projectDir: string) =>
      post<ThemeInfo | null>('/api/theme/import-from-folder', { projectDir }),
    /** Open a native file picker and import a `.zip` package or bare `.css` as a theme. Resolves null when cancelled (#106). */
    importFromFile: (projectDir: string) =>
      post<ThemeImportResult | null>('/api/theme/import-from-file', { projectDir }),
    /** Import a theme from a remote URL (raw CSS or theme folder). */
    importFromUrl: (projectDir: string, url: string) =>
      post<ThemeInfo>('/api/theme/import-from-url', { projectDir, url }),
    /** Read the raw CSS of a theme (built-in or project) for preview rendering. */
    readCss: (projectDir: string | null, source: { kind: 'builtin' | 'project'; id: string }) =>
      post<string>('/api/theme/read-css', { projectDir, source }),
    /** Remove a project-local theme by id. */
    remove: (projectDir: string, id: string) =>
      post<{ ok: true }>('/api/theme/remove', { projectDir, id }),
    /** The theme active before the current one — the "Revert" target — or null (#106). */
    getPrevious: (projectDir: string) =>
      post<ThemeInfo | null>('/api/theme/previous', { projectDir }),
    /** Re-apply the previously active theme (#106). */
    revert: (projectDir: string) =>
      post<ThemeInfo>('/api/theme/revert', { projectDir }),
  },

  project: {
    /** Resolve the project's editable stylesheets for the CSS editor picker. */
    listStyles: (projectDir: string) =>
      post<ProjectStyle[]>('/api/project/list-styles', { projectDir }),
  },

  manifest: {
    /** Read the author-facing manifest subset for the Config view's Details section. */
    read: (projectDir: string) =>
      post<ProjectConfigFields>('/api/manifest/read', { projectDir }),
    /** Apply the author-facing manifest field updates (one yaml round-trip). */
    setFields: (projectDir: string, updates: ProjectConfigFields) =>
      post<ProjectConfigFields>('/api/manifest/set-fields', { projectDir, updates }),
  },

  style: {
    /** Replace the manifest's active `styles:` list (reorder + toggle). */
    setActive: (projectDir: string, paths: string[]) =>
      post<string[]>('/api/style/set-active', { projectDir, paths }),
  },

  // status() deleted (ARCH review #8) — this wrapper had zero callers.
  // The /api/status route itself is left in place (a plain health-check GET,
  // harmless to keep reachable even with no current client).

  /** System diagnostics (tool paths, versions, Chromium/Electron info). */
  doctor: () => get<DoctorDiagnostics>('/api/doctor'),

  recovery: {
    /** Write a debounced crash-recovery snapshot of the open buffer (#44). */
    write: (filePath: string, content: string, baseMtimeMs: number) =>
      post<{ ok: boolean }>('/api/recovery/write', { filePath, content, baseMtimeMs }),
    /** Clear a recovery snapshot after a successful disk save (#44). */
    clear: (filePath: string) =>
      post<{ ok: boolean }>('/api/recovery/clear', { filePath }),
    /** List pending recovery snapshots for an opened project, newest first (#44). */
    list: (projectDir: string) =>
      post<RecoveryEntry[]>('/api/recovery/list', { projectDir }),
  },

  sync: {
    /** Fetch the yours/theirs text for one conflicted file for comparison. */
    getConflictPreview: (projectDir: string, path: string, kind?: ConflictKind) =>
      post<ConflictPreview>('/api/sync/get-conflict-preview', { projectDir, path, kind }),
    /**
     * Enable or disable the auto-sync master switch (ARCH review #8 — was
     * IPC despite being a pure settings write).
     */
    setAutoSync: (enabled: boolean) =>
      post<{ ok: boolean; autoSync: boolean }>('/api/sync/set-auto-sync', { enabled }),
    /**
     * The last sync status the host emitted for a project, or null. The
     * queryable counterpart to the fire-and-forget onSyncStatus push channel —
     * the status pill seeds itself from this right after subscribing so a
     * subscription that lands after an emit (project open racing the pill's
     * mount; the one-shot "connect"/"local" states) never strands on
     * blank/stale status.
     */
    getStatus: (projectDir: string) =>
      post<SyncStatus | null>('/api/sync/status', { projectDir }),
  },

  vcs: {
    enableVersionHistory: (projectDir: string) =>
      post<ProjectClassification>('/api/vcs/enable-version-history', { projectDir }),
    listSnapshotsPage: (projectDir: string, options?: { limit?: number; before?: string }) =>
      post<{ entries: SnapshotEntry[]; hasMore: boolean }>('/api/vcs/list-snapshots-page', { projectDir, ...options }),
    restoreSnapshot: (projectDir: string, id: string) =>
      post<{ restoredId: string; backupId?: string }>('/api/vcs/restore-snapshot', { projectDir, id }),
    saveSnapshot: (projectDir: string, message?: string) =>
      post<SnapshotEntry>('/api/vcs/save-snapshot', { projectDir, message }),
  },

  remote: {
    /** Forget the stored GitHub connection. */
    disconnectGitHub: () => post<{ ok: boolean }>('/api/remote/disconnect-github'),

    /**
     * Redacted connection status for a host (default github.com).
     * NEVER returns the token — only { connected, username?, label? }.
     */
    getRemoteConnection: (host?: string) =>
      post<RemoteConnection>('/api/remote/get-connection', host ? { host } : {}),

    /** Repositories the user granted the Gutterpress GitHub App. */
    listRemoteRepositories: () =>
      post<RemoteRepository[]>('/api/remote/list-repositories'),

    /** Branches of a chosen repository. */
    listRemoteBranches: (owner: string, repo: string) =>
      post<RemoteBranch[]>('/api/remote/list-branches', { owner, repo }),

    /** Book folders (manifest.yaml/.yml) inside a repository branch. */
    listRepoBooks: (owner: string, repo: string, branch: string) =>
      post<RepoBook[]>('/api/remote/list-repo-books', { owner, repo, branch }),

    /** Classify the project's remote situation for the environment panel. */
    diagnoseProjectRemote: (projectDir: string) =>
      post<ProjectRemoteDiagnosis>('/api/remote/diagnose-project', { projectDir }),

    /** Explicit, user-initiated remote probe (the git ls-remote equivalent). */
    testRemoteAccess: (url: string) =>
      post<RemoteAccessResult>('/api/remote/test-remote-access', { url }),

    /**
     * Validate + store a credential for any smart-HTTPS Git host.
     * Response is redacted — never includes the token.
     */
    connectGenericHost: (args: ConnectGenericHostArgs) =>
      post<{ connected: boolean; host: string; username?: string }>(
        '/api/remote/connect-generic-host',
        args,
      ),

    /** Forget the stored connection for a host. */
    disconnectHost: (host: string) =>
      post<{ ok: boolean }>('/api/remote/disconnect-host', { host }),

    /** Redacted list of stored connections (host/username/label — no tokens). */
    listHostConnections: () =>
      post<HostConnectionInfo[]>('/api/remote/list-connections'),

    /** Token-settings deep link for recognized forges; null when unknown. */
    forgeTokenUrl: (host: string) =>
      post<string | null>('/api/remote/forge-token-url', { host }),

    /** Snapshot-first sync of the project to its online repository. */
    syncChanges: (projectDir: string, message?: string) =>
      post<SyncOutcome>('/api/remote/sync', {
        projectDir,
        ...(message ? { message } : {}),
      }),

    /**
     * Download ("clone") a repository into a new local project folder
     * (ARCH review #8 — was IPC despite being a plain request/response; the
     * clone-progress push stays a separate `onCloneProgress` subscription).
     */
    cloneRepository: (args: CloneRepositoryArgs) =>
      post<{ projectDir: string }>('/api/remote/clone-repository', args),

    /**
     * Apply per-file conflict choices and sync the combined result (ARCH
     * review #8 — was IPC despite being a plain request/response).
     */
    resolveSyncConflicts: (args: ResolveSyncConflictsArgs) =>
      post<SyncOutcome>('/api/remote/resolve-sync-conflicts', args),
  },

  /**
   * Desktop update surface (ARCH review #8 — getStatus/check/download were IPC
   * despite being plain request/response; applyNow and the onEvent push
   * stream stay on the bridge — see electron-adapter.ts's `updater` getter).
   */
  updater: {
    getStatus: () => get<UpdaterStatus>('/api/updater/get-status'),
    check: () => post<UpdaterStatus>('/api/updater/check'),
    download: () => post<UpdaterStatus>('/api/updater/download'),
  },

  publish: {
    /** Provider cards: static info + redacted connection status + manifest config. */
    listProviders: (projectDir: string) =>
      post<PublishProviderCard[]>('/api/publish/list', { projectDir }),

    /** Static provider metadata — id/label/credential host. No project needed
     *  (Settings → Connections classification + labels). */
    providers: () => post<PublishProviderStaticInfo[]>('/api/publish/providers', {}),

    /**
     * Store + verify an API key for a provider. The token travels once, to the
     * host; the response is redacted and the key never comes back. An optional
     * `account` label stores a NAMED credential (a user can keep several per
     * provider); empty stores the default.
     */
    connect: (projectDir: string, providerId: string, token: string, account?: string) =>
      post<{ connected: boolean; providerId: string }>('/api/publish/connect', {
        projectDir,
        providerId,
        token,
        ...(account ? { account } : {}),
      }),

    /** Forget a stored key for a provider (the default, or a named `account`). */
    disconnect: (providerId: string, account?: string) =>
      post<{ ok: boolean }>('/api/publish/disconnect', {
        providerId,
        ...(account ? { account } : {}),
      }),

    /** Write NON-SECRET provider settings into the manifest's publish section. */
    setConfig: (projectDir: string, providerId: string, values: Record<string, string>) =>
      post<Record<string, Record<string, unknown>>>('/api/publish/set-config', {
        projectDir,
        providerId,
        values,
      }),

    /**
     * Pre-build publish preflight (#105): run the SOURCE + ASSET checks (no PDF
     * build) for a project, scoped to the selected destinations. Returns the
     * plain-language rows the wizard's Preflight step renders + gates on.
     */
    preflight: (projectDir: string, providerIds: string[]) =>
      post<PreflightRow[]>('/api/publish/preflight', { projectDir, providerIds }),

    /** Publish (or preflight with dryRun). Long-running; resolves with the result. */
    run: (
      projectDir: string,
      providerId: string,
      options?: { dryRun?: boolean; artifactPath?: string },
    ) =>
      post<PublishRunResult>('/api/publish/run', {
        projectDir,
        providerId,
        ...(options?.dryRun ? { dryRun: true } : {}),
        ...(options?.artifactPath ? { artifactPath: options.artifactPath } : {}),
      }),
  },
};
