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
 * SFE-P5c2: `project`, `manifest`, `tpl`, `snip`, `media`, `plugin`,
 * `theme`, `vcs`, and `style` were likewise migrated to typed IPC — see
 * `$lib/project-config/project-config-capability.ts` (project/manifest/tpl/
 * snip/media/plugin/theme/style) and `$lib/vcs/vcs-capability.ts` (vcs).
 * Their routes (`src/routes/api/{project,manifest,tpl,snip,media,plugin,
 * theme,vcs,style}/**`) are deleted; call those modules' exports instead of
 * `api.project.*`/`api.manifest.*`/`api.tpl.*`/`api.snip.*`/`api.media.*`/
 * `api.plugin.*`/`api.theme.*`/`api.vcs.*`/`api.style.*`.
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
  RecoveryEntry,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
} from './platform/dtos';

// Publish-preflight row DTO (#105). Pure `$lib` module — type-only here so the
// client bundle still never value-imports it through the api client.
export type { PreflightRow } from './preflight';
import type { PreflightRow } from './preflight';

// ── Genuinely api-local shapes (no canonical twin in the contract) ───────────

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

// DirEntry/ProjectFileEntry moved to `$lib/files/files-capability.ts`
// (SFE-P5c1) — the fs namespace's own DTOs now that fs moved off HTTP.
// TemplateInfo/SavedTemplateInfo/SnippetEntry/ProjectConfigFields moved to
// `$lib/platform/dtos.ts` (SFE-P5c2) — the tpl/snip/manifest namespaces' own
// DTOs now that they moved off HTTP; import them from there (or from
// `$lib/project-config/project-config-capability.ts`, which re-exports them
// alongside the functions that use them).

/** Typed API client for all server routes under src/routes/api/. */
export const api = {
  /** Low-level helpers exposed for direct use when needed. */
  _post: post,
  _get: get,

  // fs, dialog, shell, log, app deleted (SFE-P5c1) — migrated wholesale to
  // typed IPC. See `$lib/files/files-capability.ts` (fs/dialog/shell) and
  // `$lib/app-lifecycle/app-lifecycle-capability.ts` (log/app).

  // media deleted (SFE-P5c2) — migrated wholesale to typed IPC. See
  // `$lib/project-config/project-config-capability.ts`'s `media*` functions.

  lint: {
    /** Run CSS print-safety lint on the given CSS content. Returns an array of warnings. */
    checkCss: (cssPath: string, content: string) =>
      post<PrintSafeWarning[]>('/api/lint/check-css', { cssPath, content }),
    /** Run project-wide pre-build source lint checks. Returns problem entries for the Problems panel. */
    project: (projectDir: string) =>
      post<ProblemEntry[]>('/api/lint/project', { projectDir }),
  },

  // tpl, snip, plugin, theme, project, manifest, style deleted (SFE-P5c2) —
  // migrated wholesale to typed IPC. See `$lib/project-config/
  // project-config-capability.ts`'s `tpl*`/`snip*`/`plugin*`/`theme*`/
  // `projectListStyles`/`manifest*`/`styleSetActive` functions.

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

  // vcs deleted (SFE-P5c2) — migrated wholesale to typed IPC. See
  // `$lib/vcs/vcs-capability.ts`.

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
