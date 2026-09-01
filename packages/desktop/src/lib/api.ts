/**
 * Typed fetch client for SvelteKit +server.ts API routes.
 *
 * Each method corresponds to a route under src/routes/api/. Push-channel
 * subscriptions and complex orchestration flows (preview, build, vcs, sync,
 * updater) go through the feature-owned capability modules under
 * `$lib/*-capability.ts`, consumed via the shared `bridge()` accessor
 * (`$lib/platform/bridge.ts`) — not this client.
 *
 * SFE-P5c1: `fs`, `dialog`, `shell`, `log`, and `app` were migrated wholesale
 * from these HTTP routes to typed IPC — see `$lib/files/files-capability.ts`
 * (fs/dialog/shell) and `$lib/app-lifecycle/app-lifecycle-capability.ts`
 * (log/app). Their routes (`src/routes/api/{fs,dialog,shell,log,app}/**`)
 * are deleted; call `$lib/files/files-capability`'s or
 * `$lib/app-lifecycle/app-lifecycle-capability`'s exports instead of
 * `api.fs.*`/`api.dialog.*`/`api.shell.*`/`api.log.*`/`api.app.*`.
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
  UpdaterStatus,
  PublishProviderCard,
  PublishRunResult,
} from './platform/contract';

export type {
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
  ProjectClassification,
  MediaImageEntry,
  MediaImageDetails,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
} from './platform/dtos';

import type {
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectStyle,
  RecoveryEntry,
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
  /** The `preset:` this template's manifest declares — the starting point
   *  the new-book wizard seeds its preset choice from (ADR 0008). */
  preset?: string;
  /** The `targets:` this template's manifest declares, if any. */
  targets?: string[];
}

/** {@link TemplateInfo} plus what save-as-template did with out-of-book refs. */
export interface SavedTemplateInfo extends TemplateInfo {
  /** Book-local paths the `../../shared/...` refs were vendored to (vendor mode). */
  vendoredRefs?: string[];
  /** Manifest entries dropped because they pointed outside the book (exclude mode). */
  excludedRefs?: string[];
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
  /** `targets:` — the publish destinations this book is validated against
   *  (ADR 0008). `[]` is the explicit "no destination policies" opt-out. */
  targets?: string[];
}

// DirEntry/ProjectFileEntry moved to `$lib/files/files-capability.ts`
// (SFE-P5c1) — the fs namespace's own DTOs now that fs moved off HTTP.

/** Typed API client for all server routes under src/routes/api/. */
export const api = {
  /** Low-level helpers exposed for direct use when needed. */
  _post: post,
  _get: get,

  // fs, dialog, shell, log, app deleted (SFE-P5c1) — migrated wholesale to
  // typed IPC. See `$lib/files/files-capability.ts` (fs/dialog/shell) and
  // `$lib/app-lifecycle/app-lifecycle-capability.ts` (log/app).

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
    /**
     * Resolve the project's editable stylesheets for the CSS editor picker.
     *
     * `repoRoot` (when the open book lives inside a repository) also offers the
     * repo's SHARED stylesheets, so an author can enable or re-enable one from
     * the UI instead of hand-editing the manifest (2026-07-29 audit).
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
