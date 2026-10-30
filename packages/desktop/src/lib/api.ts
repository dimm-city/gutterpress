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

/**
 * The message to throw for a non-OK response. A route's own error is the
 * `{"message": …}` JSON body (see `#lib/errors`'s `unwrapRouteError`). An
 * HTML body is not from a route at all: it is the `app://` handler's error
 * page (electron/sveltekit-host.ts), sent when the server itself could not
 * answer — so say that in one sentence, with the page's `<code>` detail,
 * instead of handing a component a page of markup to display.
 */
export function hostErrorMessage(contentType: string | null, text: string): string {
  if (!/text\/html/i.test(contentType ?? '')) return text;
  const code = /<code>([\s\S]*?)<\/code>/i.exec(text)?.[1]?.trim();
  const detail = code
    ? code.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    : '';
  return `The app's internal server didn't answer.${detail ? ` (${detail})` : ''}`;
}

async function failed(r: Response): Promise<Error> {
  const text = await r.text().catch(() => r.statusText);
  return new Error(hostErrorMessage(r.headers.get('content-type'), text) || r.statusText);
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    // JSON even with no body: SvelteKit rejects a POST with no Content-Type as
    // a cross-site form submission unless its Origin is the app's own, and a
    // request the window makes over app:// reaches the server with no Origin.
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw await failed(r);
  return r.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw await failed(r);
  return r.json() as Promise<T>;
}

// ── Contract DTOs — the single source of truth ───────────────────────────────
//
// Imported type-only from `./platform/contract` (the seam interfaces +
// IPC-shared types) and `./platform/dtos` (the plain request/response DTOs),
// never re-declared here, so the api client and the host/renderer contract
// can't drift. `import type` is fully erased at build, so the SPA never
// value-imports the lib (§8 renderer purity). Re-exported so existing `#lib/api.ts` type consumers
// keep resolving.
export type {
  FileWriteResult,
  FileStat,
  SnapshotEntry,
  VersionEntry,
  VersionFileChange,
  CompareRow,
  Revision,
  RevisionList,
  RemoteConnection,
  RemoteRepository,
  BackupTarget,
  BackupSetupResult,
  RemoteBranch,
  RepoBook,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SyncOutcome,
  PublishProviderCard,
  PublishDestination,
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
  SnapshotEntry,
  VersionEntry,
  VersionFileChange,
  CompareRow,
  Revision,
  RevisionList,
  RemoteConnection,
  RemoteRepository,
  BackupTarget,
  BackupSetupResult,
  RemoteBranch,
  RepoBook,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SyncOutcome,
  SyncStatus,
  CloneRepositoryArgs,
  UpdaterStatus,
  PublishProviderCard,
  PublishDestination,
  PublishDestinationStatus,
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
  ExtensionSourceKind,
  ExtensionCarries,
  ProjectExtensionEntry,
  ExtensionValidationResult,
  BundledExtensionInfo,
  ExtensionImportResult,
  ExtensionImportWarning,
  NpmExtensionMatch,
  ExtensionSearchResult,
  ExtensionUpdatesResult,
  ProjectStyle,
  BookCss,
  TokenUpdate,
  RecoveryEntry,
  ProjectClassification,
  MediaImageEntry,
  MediaImageDetails,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
  ProblemReport,
  DoctorInstallResult,
} from './platform/dtos';

import type {
  LogFileEntry,
  AppImageIntegrationStatus,
  AppImageIntegrationInstallResult,
  AppImageIntegrationRemoveResult,
  DiscoveredProject,
  ProjectExtensionEntry,
  ExtensionValidationResult,
  BundledExtensionInfo,
  ExtensionImportResult,
  ExtensionSearchResult,
  ExtensionUpdatesResult,
  ProjectStyle,
  BookCss,
  TokenUpdate,
  RecoveryEntry,
  ProjectClassification,
  MediaImageEntry,
  MediaImageDetails,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
  ProblemReport,
  DoctorInstallResult,
} from './platform/dtos';

// Publish-preflight row DTO (#105). Pure `#lib` module — type-only here so the
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
  /** The `preset:` this template's manifest declares — the starting point
   *  the new-book wizard seeds its preset choice from (ADR 0008). */
  preset?: string;
  /** The `targets:` this template's manifest declares, if any. */
  targets?: string[];
  /** The `page:` size (points) a `custom`-preset template is designed for, if any. */
  page?: { width: number; height: number };
}

/** {@link TemplateInfo} plus what save-as-template did with out-of-book refs. */
export interface SavedTemplateInfo extends TemplateInfo {
  /** Book-local paths the `../../shared/...` refs were vendored to (vendor mode). */
  vendoredRefs?: string[];
  /** Manifest entries dropped because they pointed outside the book (exclude mode). */
  excludedRefs?: string[];
}

/**
 * Which level a snippet comes from — mirrors the lib's `SnippetSource` by
 * hand (CLAUDE.md §8: the SPA never imports `gutterpress`). `project` is the
 * book's own (the only level `api.snip.save`/`api.snip.delete` touch, so the
 * only one the picker offers to delete); `extension` is read-only, `name`
 * being its display name; `core` is reserved for snippets Gutterpress ships.
 */
export type SnippetSource =
  | { kind: 'project' }
  | { kind: 'extension'; ref: string; name: string }
  | { kind: 'core' };

export interface SnippetEntry {
  name: string;
  fileName: string;
  variables: string[];
  body: string;
  source: SnippetSource;
  /** Set when this is the example snippet for that component (marker name). */
  component?: string;
}

/**
 * A plugin component (a declared marker such as `@term-box`) with the
 * winning example snippet (book, then extension, then core) the editor
 * inserts for it. Mirrors the lib's `MarkerComponent` by hand.
 */
export interface MarkerComponent {
  /** Marker name without `@`. */
  name: string;
  source: Extract<SnippetSource, { kind: 'extension' }>;
  /** Variant names accepted as the marker's bare word (`@name <variant>`). */
  variants: string[];
  /** One element with no body and no `@end-<name>`: inserted without a closing pair. */
  selfClosing?: true;
  snippet?: string;
}

/**
 * A `page` / `chapter` / `section` variant (`@page blank`, `@section card`)
 * the book can use. Mirrors the lib's `LocationVariant` by hand.
 */
export interface LocationVariant {
  kind: 'page' | 'chapter' | 'section';
  /** The word after the marker: `@page <word>`. */
  word: string;
  /** The class it adds to the emitted element. */
  class: string;
  source: Extract<SnippetSource, { kind: 'extension' | 'core' }>;
  label?: string;
  snippet?: string;
}

/**
 * A class an extension's component catalog (`gutterpress.components`, a
 * `components.yaml`) documents, or one the book's own stylesheets use. Declared
 * by hand: the SPA never imports `gutterpress` (CLAUDE.md §8). Core's own
 * `gp-*` classes are not here; the editor carries those (`core-classes.ts`).
 */
export interface ClassCatalogEntry {
  /** The class without its dot. */
  class: string;
  /** One line from the catalog (`description`, else `notes`, `breaks`, `recipe`); absent for a stylesheet class. */
  description?: string;
  /** The catalog marks it as a modifier: a class that changes a component without being one. Offered as a Block properties toggle. */
  modifier?: true;
  /** Marker words (without `@`) the catalog's recipe writes the class on; empty when it names none. */
  appliesTo: string[];
  /** The catalog entry's `label`, else its name — the name a modifier toggle shows. */
  label?: string;
  source: Extract<SnippetSource, { kind: 'extension' }> | { kind: 'book' };
}

/** Static publish-provider metadata (no project needed) — used by the
 *  Accounts page to classify + label stored credentials. */
export interface PublishProviderStaticInfo {
  id: string;
  label: string;
  kind: 'api' | 'guided';
  credentialRequired: boolean;
  /** The TokenStore host this provider's credentials are keyed under. */
  credentialHost: string | null;
  tokenUrl: string | null;
  hint: string | null;
  /** #221 — "oauth" = the browser consent flow (gdrive); null/absent = the
   *  existing paste-an-API-key flow. Drives Connections' add-a-key branch. */
  connectKind: 'token' | 'oauth' | null;
}

// ── Project configuration view — author-facing manifest subset ─────────────
// Declared locally (mirrors the lib's `ProjectConfigFields`) so the SPA bundle
// stays free of value imports from `gutterpress` (§8 renderer purity).

export interface ProjectConfigFields {
  title?: string;
  authors?: string[];
  /** The manifest's `chapters` — null is the deliberate "all chapter files" sentinel. */
  sourceFiles?: string[] | null;
  /** `targets:` — the publish destinations this book is validated against
   *  (ADR 0008). `[]` is the explicit "no destination policies" opt-out. */
  targets?: string[];
}

/**
 * A book's page geometry as the lib records it — the manifest's preset +
 * bounds (the size it prints at and is checked against) and the margins it
 * prints with, in points — and what the author picks. Type-only imports erase
 * at build time, so the SPA still never value-imports the lib (§8).
 */
import type { PageMargin, PageSetup, PageSetupChange, PageSizeChoice } from 'gutterpress';
export type { PageMargin, PageSetup, PageSetupChange, PageSizeChoice };

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
    /**
     * Open native PDF save dialog, optionally opening in `defaultDir`.
     * Resolves null when cancelled.
     */
    savePdf: (defaultName?: string, defaultDir?: string) =>
      post<string | null>('/api/dialog/save-pdf', {
        ...(defaultName !== undefined ? { defaultName } : {}),
        ...(defaultDir !== undefined ? { defaultDir } : {}),
      }),
    /**
     * Native folder picker for a build's output folder (may create one). The
     * chosen folder becomes a valid `api:build` `out` and publish artifact.
     * Resolves null when cancelled.
     */
    pickOutputFolder: (defaultPath?: string) =>
      post<string | null>(
        '/api/dialog/pick-output-folder',
        defaultPath !== undefined ? { defaultPath } : {},
      ),
    /** Open native single image file picker. Resolves null when cancelled. */
    pickImageFile: () => post<string | null>('/api/dialog/pick-image-file'),
    /** Native open dialog for the publish artifact (PDF). Null when cancelled. */
    pickPdfFile: () => post<string | null>('/api/dialog/pick-pdf-file'),
    /** Open native multi-select image file picker. Resolves [] when cancelled. */
    pickImageFiles: () => post<string[]>('/api/dialog/pick-image-files'),
    /** Native Save / Don't Save / Cancel prompt for a file with unsaved edits. */
    confirmUnsaved: (fileName: string) =>
      post<'save' | 'discard' | 'cancel'>('/api/dialog/confirm-unsaved', { fileName }),
  },

  shell: {
    /** Open a URL in the system browser. */
    openExternal: (url: string) => post<{ ok: boolean }>('/api/shell/open-external', { url }),
    /** Reveal a file in the OS file manager. */
    showInFolder: (filePath: string) =>
      post<{ ok: boolean }>('/api/shell/show-in-folder', { filePath }),
    /** Open a terminal (bash; Command Prompt on Windows without bash) in the open book's folder. */
    openTerminal: (projectDir: string) =>
      post<{ ok: boolean; label: string }>('/api/shell/open-terminal', { projectDir }),
  },

  report: {
    /** Build the "Report a problem" bundle for the open book (null = no book). */
    bundle: (projectDir: string | null) =>
      post<ProblemReport>('/api/report/bundle', { projectDir }),
  },

  log: {
    /** Read an operation log file. Returns null when the file doesn't exist. */
    read: (logPath: string) => post<string | null>('/api/log/read', { logPath }),
    /** List the app's diagnostic log files (newest first). */
    list: () => post<LogFileEntry[]>('/api/log/list', {}),
    /** Delete every log file the list shows. */
    prune: () => post<{ removed: number }>('/api/log/prune', {}),
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
    // No copyFile wrapper — the SPA's image-insert flow calls
    // api.media.importImage. The /api/fs/copy-file ROUTE is retained
    // deliberately: it guards the shared picker-capability + fs-guard path and
    // carries that mechanism's security regression tests.
    // No folder-watch wrapper either — the folder watch is IPC-only
    // (preload.ts / electron-adapter.ts).
    /** List top-level .md and .css files in a project directory. */
    listProjectFiles: (projectDir: string) =>
      post<ProjectFileEntry>('/api/fs/list-project-files', { projectDir }),

    // ── Tree CRUD ────────────────────────────────────────────────────────
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
     * deleting if that safety snapshot fails. The item is set aside, not
     * removed: `undoToken` brings it back through `undoDelete` (#313).
     */
    deletePath: (path: string, projectDir: string) =>
      post<{ ok: true; undoToken: string }>('/api/fs/delete', { path, projectDir }),
    /** Restore the item a `deletePath` set aside. Only the latest delete can be undone. */
    undoDelete: (token: string) => post<{ path: string }>('/api/fs/undo-delete', { token }),
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
    /** Get the recent folders list (with exists flag). `lastActiveBook` is
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
    // No flushDone wrapper: the flush-before-close reply is fired directly
    // over IPC (preload.ts's onFlushBeforeClose calls
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
     * implementation of the import policy: already-inside
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
    /**
     * Save the open project as a reusable custom template. A repo-nested book's
     * out-of-book (`../../shared/...`) refs are made portable per `sharedRefs`
     * (default `"vendor"` — copy them in; `"exclude"` — drop them). The result
     * reports what happened via `vendoredRefs`/`excludedRefs`.
     */
    saveAsTemplate: (opts: {
      projectDir: string;
      name: string;
      sharedRefs?: 'vendor' | 'exclude';
    }) => post<SavedTemplateInfo>('/api/tpl/save-as-template', opts),
    /** Open a native folder picker and import the selected folder as a template. Resolves null when cancelled. */
    importFromFolder: () => post<TemplateInfo | null>('/api/tpl/import-from-folder', {}),
  },

  snip: {
    /** Every snippet the book can insert, from every level (book, extensions,
     *  core), bodies included — each entry's `source` says which level. */
    list: (projectDir: string) => post<SnippetEntry[]>('/api/snip/list', { projectDir }),
    /** The project's plugin components, each with its winning example snippet. */
    components: (projectDir: string) => post<MarkerComponent[]>('/api/snip/components', { projectDir }),
    /** The page / chapter / section variants the project can use: core's plus each extension's. */
    variants: (projectDir: string) => post<LocationVariant[]>('/api/snip/variants', { projectDir }),
    /** The classes the book's extensions document (their component catalog) and its own stylesheets use. */
    classes: (projectDir: string) => post<ClassCatalogEntry[]>('/api/snip/classes', { projectDir }),
    /** Save a snippet body under the project's snippets/ folder. Always
     *  writes to the PROJECT, even when the list currently shown includes
     *  extension-provided entries (#242) — there is no way to target an
     *  extension's folder through this call. */
    save: (projectDir: string, name: string, body: string) =>
      post<SnippetEntry>('/api/snip/save', { projectDir, name, body }),
    /** Delete a PROJECT snippet by filename. Structurally cannot reach an
     *  extension's folder (#242) — the host's `deleteSnippet` only ever
     *  resolves paths inside the project's own snippets/ dir. */
    delete: (projectDir: string, fileName: string) =>
      post<{ ok: boolean }>('/api/snip/delete', { projectDir, fileName }),
  },

  /**
   * The ONE extension rail (#265). A look is an extension that carries
   * styles, a feature is one that carries markdown, a component library
   * carries both — every one is a `use` specifier in the manifest's
   * `extensions:` list, and `list` returns them all in cascade order. Book
   * setup's Look and Extensions tabs show that list with this one verb set; `use`
   * is the stable ref every mutating call takes.
   */
  extension: {
    /** Every configured extension, in manifest (= cascade) order. */
    list: (projectDir: string) =>
      post<ProjectExtensionEntry[]>('/api/extension/list', { projectDir }),
    /**
     * Add by specifier: a bundled feature name (written as-is), an npm
     * package `name`/`name@version` (downloaded, verified, vendored, pinned
     * — behind the native trust gate; null when the author cancels it), or a
     * project-relative `./path` (referenced in place). `exportName` selects a
     * named plugin function for packages without a default export.
     */
    add: (projectDir: string, specifier: string, exportName?: string) =>
      post<ProjectExtensionEntry | null>('/api/extension/add', {
        projectDir,
        specifier,
        ...(exportName ? { exportName } : {}),
      }),
    /** Native picker for a folder or plugin file on disk, referenced in place (never copied). Null when cancelled. */
    addLocal: (projectDir: string) =>
      post<ProjectExtensionEntry | null>('/api/extension/add-local', { projectDir }),
    /** Drop one entry. A path entry's folder is never touched; an npm entry's vendored copy is deleted. */
    remove: (projectDir: string, use: string) =>
      post<{ ok: true }>('/api/extension/remove', { projectDir, use }),
    /** Flip one entry's per-project `enabled` flag. */
    setEnabled: (projectDir: string, use: string, enabled: boolean) =>
      post<{ ok: true }>('/api/extension/set-enabled', { projectDir, use, enabled }),
    /** Rewrite the list order — the CSS cascade and markdown registration order. Must name every `use` exactly once. */
    reorder: (projectDir: string, order: string[]) =>
      post<{ ok: true }>('/api/extension/reorder', { projectDir, order }),
    /** Load-test every configured extension; reports ok/error per entry. */
    validate: (projectDir: string) =>
      post<ExtensionValidationResult[]>('/api/extension/validate', { projectDir }),
    /** The bundled extensions (markdown features and looks) an author can turn on with no install (static). */
    bundled: () => get<BundledExtensionInfo[]>('/api/extension/bundled'),
    /** Search npm for extensions (#246), on demand: the Extensions tab's search, never project load. A network/parse failure is data (`ok: false`), never a thrown error. */
    search: (query: string) => post<ExtensionSearchResult>('/api/extension/search', { query }),
    /** Each pinned npm extension against npm's latest, on demand (the Extensions tab, never project load). A network failure is data (`ok: false`), never a thrown error. */
    outdated: (projectDir: string) =>
      post<ExtensionUpdatesResult>('/api/extension/outdated', { projectDir }),
    /** A configured extension's stylesheets, concatenated (a bundled look's inlined css, or the entry's folder) — for a sample thumbnail. */
    readCss: (projectDir: string, use: string) =>
      post<string>('/api/extension/read-css', { projectDir, use }),
    /** Native picker for a `.zip` package or bare `.css`, imported into `extensions/<id>/` (#106). Null when cancelled. */
    importFromFile: (projectDir: string) =>
      post<ExtensionImportResult | null>('/api/extension/import-from-file', { projectDir }),
    /** Import a look from an http(s) URL (raw CSS or a folder URL) into `extensions/<id>/`. */
    importFromUrl: (projectDir: string, url: string) =>
      post<ExtensionImportResult>('/api/extension/import-from-url', { projectDir, url }),
  },

  project: {
    /**
     * Resolve the project's editable stylesheets for the CSS editor picker.
     *
     * `repoRoot` (when the open book lives inside a repository) also offers the
     * repo's SHARED stylesheets, so an author can enable or re-enable one from
     * the UI instead of hand-editing the manifest.
     */
    listStyles: (projectDir: string, repoRoot?: string | null) =>
      post<ProjectStyle[]>('/api/project/list-styles', {
        projectDir,
        ...(repoRoot ? { repoRoot } : {}),
      }),
  },

  manifest: {
    /** Read the author-facing manifest subset for the Config view's Details section. */
    read: (projectDir: string) =>
      post<ProjectConfigFields>('/api/manifest/read', { projectDir }),
    /** Apply the author-facing manifest field updates (one yaml round-trip). */
    setFields: (projectDir: string, updates: ProjectConfigFields) =>
      post<ProjectConfigFields>('/api/manifest/set-fields', { projectDir, updates }),
  },

  pageSize: {
    /** Read the book's page geometry back from its manifest (margins it does not set: from its stylesheets). */
    read: (projectDir: string) =>
      post<PageSetup>('/api/page-size/read', { projectDir }),
    /** Change it in the manifest: the size, the margins, or both; a part left out stays as recorded. */
    set: (projectDir: string, change: PageSetupChange) =>
      post<PageSetup>('/api/page-size/set', { projectDir, change }),
  },

  style: {
    /** Replace the manifest's active `styles:` list (reorder + toggle). */
    setActive: (projectDir: string, paths: string[]) =>
      post<string[]>('/api/style/set-active', { projectDir, paths }),
    /**
     * The book's stylesheet as the build assembles it, as ordered chunks
     * tagged with their origin (core, an extension's file or `css` export, a
     * book sheet), each with its root-level `:root` custom properties, read
     * host-side with postcss (#454).
     */
    bookCss: (projectDir: string) => post<BookCss>('/api/style/book-css', { projectDir }),
    /**
     * Write token edits with a postcss edit of the book's own stylesheets: in
     * place where one declares the token, else into `file`'s `:root` (an
     * absolute path, one of the book's sheets); null takes it out of every sheet.
     */
    editTokens: (projectDir: string, file: string, updates: TokenUpdate[]) =>
      post<{ written: string[] }>('/api/style/edit-tokens', { projectDir, file, updates }),
  },

  // The /api/status route (a plain health-check GET) has no client wrapper.

  /** System diagnostics (tool paths, versions, Chromium/Electron info). */
  doctor: () => get<DoctorDiagnostics>('/api/doctor'),
  /** Install a missing optional tool with the platform's package manager. */
  doctorInstall: (toolId: string) =>
    post<DoctorInstallResult>('/api/doctor/install', { toolId }),

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
    /**
     * Enable or disable the auto-sync master switch (a pure settings write,
     * so a route, not IPC).
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
      post<{ entries: VersionEntry[]; hasMore: boolean }>('/api/vcs/list-snapshots-page', { projectDir, ...options }),
    /** Versions online that this computer has not got (#408). */
    onlineVersions: (projectDir: string) =>
      post<{ entries: VersionEntry[]; reason?: 'no-remote' | 'auth' | 'offline' }>('/api/vcs/online-versions', { projectDir }),
    /** The files one version changed, each with a plain hint; `more` beyond the ones listed (#408). */
    versionChanges: (projectDir: string, id: string) =>
      post<{ files: VersionFileChange[]; more: number }>('/api/vcs/version-changes', { projectDir, id }),
    /** One text file at a version beside the file as it is now, as aligned rows (#408). */
    compareFile: (projectDir: string, id: string, path: string) =>
      post<{ binary: true } | { binary: false; rows: CompareRow[] }>('/api/vcs/compare-file', { projectDir, id, path }),
    /** Render a version read-only; the URL for its frame, or null when a later open or close replaced it first (#408). */
    openVersionPreview: (projectDir: string, id: string) =>
      post<{ url: string } | null>('/api/vcs/open-version-preview', { projectDir, id }),
    closeVersionPreview: () => post<{ closed: true }>('/api/vcs/close-version-preview', {}),
    restoreSnapshot: (projectDir: string, id: string) =>
      post<{ restoredId: string; backupId?: string }>('/api/vcs/restore-snapshot', { projectDir, id }),
    /** Files changed since the last version (saved, but not in a version yet);
     *  `changedFiles` is null for a plain folder with no version history;
     *  `stale` = a crashed version attempt may have left staged work. */
    unversionedChanges: (projectDir: string) =>
      post<{ changedFiles: number | null; stale: boolean }>('/api/vcs/unversioned-changes', { projectDir }),
    saveSnapshot: (projectDir: string, message?: string) =>
      post<SnapshotEntry>('/api/vcs/save-snapshot', { projectDir, message }),
    /** Switch the project's working tree to another revision (#273). */
    switchBranch: (projectDir: string, branch: string) =>
      post<{ current: string; changedFiles: string[] }>('/api/vcs/switch-branch', { projectDir, branch }),
    /** The book's revisions and where each is kept (#448); `null` without version history.
     *  `refresh` checks the online copy first (best-effort; see `checkedOnline`). */
    listRevisions: (projectDir: string, options?: { refresh?: boolean }) =>
      post<RevisionList | null>('/api/vcs/list-revisions', { projectDir, ...options }),
    /** Start a new revision from what is open now and switch to it (#448). */
    createRevision: (projectDir: string, name: string) =>
      post<{ current: string }>('/api/vcs/create-revision', { projectDir, name }),
    /** Rename a revision; an online one is renamed in the online copy too (#448). */
    renameRevision: (projectDir: string, from: string, to: string) =>
      post<{ current: string | null; name: string }>('/api/vcs/rename-revision', { projectDir, from, to }),
    /** Delete a revision that is not open (#448). Without `discard`, a revision holding versions
     *  found nowhere else is not deleted: the result says how many would be lost. */
    deleteRevision: (projectDir: string, name: string, options?: { everywhere?: boolean; discard?: boolean }) =>
      post<{ deleted: true } | { deleted: false; versionsOnlyHere: number }>('/api/vcs/delete-revision', { projectDir, name, ...options }),
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

    /**
     * Online backup for a book that started on this computer (#358): create a
     * GitHub repository (or use an empty one), connect the book to it and push
     * its history. Resolves with `status: "failed"` + a plain message for
     * every expected problem; it rejects only on unexpected errors.
     */
    setUpBackup: (projectDir: string, target: BackupTarget) =>
      post<BackupSetupResult>('/api/remote/set-up-backup', { projectDir, target }),

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

    /** Sync the project with its online copy: get the latest, then back up. */
    syncChanges: (projectDir: string, message?: string) =>
      post<SyncOutcome>('/api/remote/sync', {
        projectDir,
        ...(message ? { message } : {}),
      }),

    /** Whether the book's branch has moved online (reads refs only; never throws). */
    checkUpdates: (projectDir: string) =>
      post<{ available: boolean; reason?: 'no-remote' | 'auth' | 'offline' }>('/api/remote/check-updates', { projectDir }),

    /**
     * "Repair the online copy": replace the book's broken history with a fresh
     * download of the online copy, keep every file on this computer, restore
     * files that exist only online, then save a version and back up. The old
     * history is kept aside, never deleted.
     */
    repairOnlineBackup: (projectDir: string) =>
      post<{ outcome: SyncOutcome; restoredFiles: string[] }>('/api/remote/repair', { projectDir }),

    /**
     * "Scorched earth": copy the folder to a backup, empty it, download a
     * fresh copy from its online address, then copy the backed-up files (not
     * the old history) back on top. Nothing is saved or backed up afterwards.
     */
    scorchedEarth: (projectDir: string) =>
      post<{ dir: string; backupDir: string; branch?: string }>('/api/remote/scorched-earth', { projectDir }),

    /**
     * Download ("clone") a repository into a new local project folder
     * (plain request/response, so a route; the clone-progress push is a
     * separate `onCloneProgress` subscription).
     */
    cloneRepository: (args: CloneRepositoryArgs) =>
      post<{ projectDir: string }>('/api/remote/clone-repository', args),

  },

  /**
   * Desktop update surface (getStatus/check/download are plain
   * request/response routes; applyNow and the onEvent push stream stay on the
   * bridge — see electron-adapter.ts's `updater` getter).
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
     * provider); empty stores the default. `projectDir` is null with no book
     * (the Accounts page): the check then reads no manifest settings, so
     * Shopify's check takes its store address as `shop` (not stored).
     */
    connect: (projectDir: string | null, providerId: string, token: string, account?: string, shop?: string) =>
      post<{ connected: boolean; providerId: string }>('/api/publish/connect', {
        ...(projectDir ? { projectDir } : {}),
        providerId,
        token,
        ...(account ? { account } : {}),
        ...(shop ? { shop } : {}),
      }),

    /** Forget a stored key for a provider (the default, or a named `account`). */
    disconnect: (providerId: string, account?: string) =>
      post<{ ok: boolean }>('/api/publish/disconnect', {
        providerId,
        ...(account ? { account } : {}),
      }),

    /**
     * Save NON-SECRET provider settings. The host files each where it belongs:
     * the team's (destinations ticked as `enabled: true`, targets, folders) in
     * the manifest's publish section, only the person's own (their account, a
     * folder outside the book) in their private settings. An empty string clears.
     */
    setConfig: (projectDir: string, providerId: string, values: Record<string, string | boolean>) =>
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

    /**
     * Existing places a provider can publish into (#221, gdrive: Drive
     * folders) — provider-neutral; the wizard only calls this when the
     * provider's card carries `destinations` (see `listProviders`).
     */
    listDestinations: (projectDir: string, providerId: string) =>
      post<PublishDestination[]>('/api/publish/destinations/list', { projectDir, providerId }),

    /** Create a new destination (gdrive: a Drive folder at My Drive root). */
    createDestination: (projectDir: string, providerId: string, name: string) =>
      post<PublishDestination>('/api/publish/destinations/create', { projectDir, providerId, name }),

    /** Where this person publishes among the destinations, and whether they
     *  must choose one (#452, gdrive: the book's folder or their own). */
    destinationStatus: (projectDir: string, providerId: string) =>
      post<PublishDestinationStatus>('/api/publish/destinations/status', { projectDir, providerId }),
  },
};
