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
// (which itself sources them from `shared-types.ts` / the lib), so the api
// client and the host/renderer contract can never disagree again. `import type`
// is fully erased at build, so the SPA still never value-imports the lib
// (§8 / ADR 0004 renderer purity). Re-exported so existing `$lib/api` type
// consumers keep resolving.
export type {
  DiscoveredProject,
  PluginKind,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ProjectStyle,
  FileWriteResult,
  FileStat,
  RecoveryEntry,
  ConflictKind,
  ConflictPreview,
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
} from './platform/contract';

import type {
  DiscoveredProject,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ProjectStyle,
  FileWriteResult,
  FileStat,
  RecoveryEntry,
  ConflictKind,
  ConflictPreview,
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
  CloneRepositoryArgs,
  ResolveSyncConflictsArgs,
  UpdaterStatus,
  ProjectClassification,
  PublishProviderCard,
  PublishRunResult,
} from './platform/contract';

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

// ── Project configuration view (#PCV) — author-facing manifest subset ──────
// Declared locally (mirrors the lib's `ProjectConfigFields`) so the SPA bundle
// stays free of value imports from `@dimm-city/print-md` (§8 renderer purity).

export interface ProjectConfigFields {
  title?: string;
  authors?: string[];
  /** `output.filename`; the built PDF's name. */
  outputFilename?: string;
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
    /** Copy a file into a destination directory. Creates destDir if absent. Returns the dest path. */
    copyFile: (src: string, dest: string) =>
      post<string>('/api/fs/copy-file', { src, dest }),
    // watchFolder/unwatchFolder deleted (ARCH review #8) — the folder watch
    // stays IPC-only (preload.ts / electron-adapter.ts); these client
    // wrappers and their /api/fs/{watch,unwatch}-folder routes had zero
    // callers, the IPC path being the live one.
    /** List top-level .md and .css files in a project directory. */
    listProjectFiles: (projectDir: string) =>
      post<ProjectFileEntry>('/api/fs/list-project-files', { projectDir }),
  },

  app: {
    /** Get viewer prefs (lastProjectDir, recentFolders, projectStates, etc.). */
    getViewerPrefs: () => get<Record<string, unknown>>('/api/app/viewer-prefs'),
    /** Shallow-merge patch into viewer prefs. */
    setViewerPrefs: (prefs: Record<string, unknown>) => post<{ ok: boolean }>('/api/app/viewer-prefs', prefs),
    /** Get per-project editor/preview state for the given projectDir. */
    getViewerProjectState: (projectDir: string) =>
      post<Record<string, unknown> | null>('/api/app/viewer-project-state/get', { projectDir }),
    /** Set per-project editor/preview state for the given projectDir. */
    setViewerProjectState: (projectDir: string, state: Record<string, unknown>) =>
      post<{ ok: boolean }>('/api/app/viewer-project-state/set', { projectDir, state }),
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
    /** Discover print-md projects under the configured search roots. */
    discoverProjects: () => post<DiscoveredProject[]>('/api/app/discover-projects', {}),
    /** Classify a project folder (source type + capabilities + repo book list). */
    classifyProject: (projectDir: string) =>
      post<{
        source: unknown;
        capabilities: unknown;
        repoRoot?: string;
        books?: Array<{ path: string; title: string; subPath: string }>;
      }>('/api/app/classify-project', { projectDir }),
    /** Scaffold a new project from a template. */
    createProject: (opts: Record<string, unknown>) => post<unknown>('/api/app/create-project', opts),
    /** Adopt an existing folder as a print-md project. */
    adoptFolder: (opts: Record<string, unknown>) => post<unknown>('/api/app/adopt-folder', opts),
    /** Push a splash status update (status text, progress 0-100, sub-status). */
    splashStatus: (status?: string, progress?: number, sub?: string) =>
      post<{ ok: boolean }>('/api/app/splash-status', { status, progress, sub }),
    /** Signal that the renderer first screen is ready (closes the splash). */
    rendererReady: () => post<{ ok: boolean }>('/api/app/renderer-ready', {}),
    /** Push the renderer dirty state to the main process close gate. */
    setDirtyState: (dirty: boolean) => post<{ ok: boolean }>('/api/app/dirty-state', { dirty }),
    // flushDone deleted (ARCH review #8) — this wrapper (and the
    // /api/app/flush-done route) had zero callers: the real flush-before-close
    // reply is fired directly over IPC (preload.ts's onFlushBeforeClose calls
    // ipcRenderer.invoke("app:flushDone") — it can't route through fetch, since
    // it must resolve synchronously with the renderer's own close-time flush).
  },

  media: {
    /** List all image files under a project directory (recursive, bounded). */
    listImages: (projectDir: string) =>
      post<Array<{ name: string; relPath: string; path: string; size: number; mtimeMs: number }>>(
        '/api/media/list-images',
        { projectDir },
      ),
    /** Generate a small (≤192px) thumbnail data URL for an image. Returns null when unavailable. */
    thumbnail: (imagePath: string, width?: number, height?: number) =>
      post<string | null>('/api/media/thumbnail', { imagePath, width, height }),
    /** Inspect an image file — returns file size + header metadata (dimensions, DPI, alpha, color space). */
    inspect: (imagePath: string) =>
      post<{
        fileSize: number;
        info: {
          width: number;
          height: number;
          xDpi: number;
          yDpi: number;
          hasAlpha: boolean;
          colorSpace: 'srgb' | 'gray' | 'cmyk' | '';
        } | null;
      } | null>('/api/media/inspect', { imagePath }),
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
      post<Array<{ rule: string; severity: 'error' | 'warning'; message: string; line: number; column: number }>>(
        '/api/lint/check-css',
        { cssPath, content },
      ),
    /** Run project-wide pre-build source lint checks. Returns problem entries for the Problems panel. */
    project: (projectDir: string) =>
      post<Array<{
        filePath?: string;
        file?: string;
        line?: number;
        column?: number;
        severity: 'error' | 'warning' | 'info';
        message: string;
        source: string;
      }>>('/api/lint/project', { projectDir }),
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
    /** Add an npm package as a plugin entry in the manifest. */
    addNpm: (projectDir: string, packageName: string) =>
      post<ProjectPluginEntry>('/api/plugin/add-npm', { projectDir, packageName }),
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
    /** Import a theme from a remote URL (raw CSS or theme folder). */
    importFromUrl: (projectDir: string, url: string) =>
      post<ThemeInfo>('/api/theme/import-from-url', { projectDir, url }),
    /** Read the raw CSS of a theme (built-in or project) for preview rendering. */
    readCss: (projectDir: string | null, source: { kind: 'builtin' | 'project'; id: string }) =>
      post<string>('/api/theme/read-css', { projectDir, source }),
    /** Remove a project-local theme by id. */
    remove: (projectDir: string, id: string) =>
      post<{ ok: true }>('/api/theme/remove', { projectDir, id }),
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
  doctor: () => get<unknown>('/api/doctor'),

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

    /** Repositories the user granted the print-md GitHub App. */
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
   * Auto-update surface (ARCH review #8 — getStatus/check/download were IPC
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

    /**
     * Store + verify an API key for a provider. The token travels once, to the
     * host; the response is redacted and the key never comes back.
     */
    connect: (projectDir: string, providerId: string, token: string) =>
      post<{ connected: boolean; providerId: string }>('/api/publish/connect', {
        projectDir,
        providerId,
        token,
      }),

    /** Forget the stored key for a provider. */
    disconnect: (providerId: string) =>
      post<{ ok: boolean }>('/api/publish/disconnect', { providerId }),

    /** Write NON-SECRET provider settings into the manifest's publish section. */
    setConfig: (projectDir: string, providerId: string, values: Record<string, string>) =>
      post<Record<string, Record<string, unknown>>>('/api/publish/set-config', {
        projectDir,
        providerId,
        values,
      }),

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
