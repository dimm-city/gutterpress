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

// ── Local type declarations (mirrors from contract.ts — no import to keep SPA clean) ─

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

// ── Plugin manager types ────────────────────────────────────────────────────

export type PluginKind = 'local' | 'npm';

export interface ProjectPluginEntry {
  ref: string;
  kind: PluginKind;
  enabled: boolean;
}

export interface PluginValidationResult {
  ref: string;
  kind: PluginKind;
  enabled: boolean;
  ok: boolean;
  error?: string;
}

export interface RecommendedPlugin {
  name: string;
  label?: string;
  description: string;
  builtin?: boolean;
}

// ── Theme manager types ─────────────────────────────────────────────────────

export interface ThemeInfo {
  id: string;
  name: string;
  author?: string;
  description: string;
  kind: 'builtin' | 'project';
  preview?: string | null;
}

export type ApplyThemeTarget =
  | { kind: 'builtin'; id: string }
  | { kind: 'project'; id: string };

// ── Style resolver type ─────────────────────────────────────────────────────

export interface ProjectStyle {
  path: string;
  displayName: string;
  active: boolean;
}

export interface FileWriteResult {
  mtimeMs: number;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
  exists: boolean;
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

export interface RecoveryEntry {
  filePath: string;
  recoveryPath: string;
  savedAt: number;
  baseMtimeMs: number;
}

export type ConflictKind = 'both-edited' | 'you-deleted' | 'online-deleted';

export interface ConflictPreview {
  mine: string;
  theirs: string;
  kind: ConflictKind;
  isBinary: boolean;
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
    /** Start watching a folder for changes. Only one watch at a time. */
    watchFolder: (dirPath: string) => post<{ ok: boolean }>('/api/fs/watch-folder', { path: dirPath }),
    /** Stop watching the currently watched folder. */
    unwatchFolder: (dirPath?: string) =>
      post<{ ok: boolean }>('/api/fs/unwatch-folder', dirPath ? { path: dirPath } : {}),
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
    /** Get the recent folders list (with exists flag). */
    getRecentFolders: () => get<Array<{ path: string; title: string; exists: boolean }>>('/api/app/recent-folders'),
    /** Get the favorites list (with exists flag). */
    getFavorites: () => get<Array<{ path: string; title: string; exists: boolean }>>('/api/app/favorites'),
    /** Toggle a folder in the favorites list. */
    toggleFavorite: (path: string, title: string) =>
      post<{ favorited: boolean }>('/api/app/favorites/toggle', { path, title }),
    /** Remove a folder from the recent list. */
    removeRecent: (path: string) => post<{ ok: boolean }>('/api/app/recent/remove', { path }),
    /** Discover print-md projects under the configured search roots. */
    discoverProjects: () => post<unknown[]>('/api/app/discover-projects', {}),
    /** Classify a project folder (source type + capabilities). */
    classifyProject: (projectDir: string) =>
      post<{ source: unknown; capabilities: unknown }>('/api/app/classify-project', { projectDir }),
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
    /** Signal that the renderer has flushed its buffer (close gate reply). */
    flushDone: () => post<{ ok: boolean }>('/api/app/flush-done', {}),
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

  /** Health check — returns { ok: true, name, runtime }. */
  status: () => get<{ ok: boolean; name: string; runtime: string }>('/api/status'),

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
  },
};
