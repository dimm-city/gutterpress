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
 * SFE-P5c3: `remote`, `sync`, and `publish` — the credentials-sensitive
 * group — were likewise migrated to typed IPC — see
 * `$lib/remote/remote-capability.ts` (remote/sync) and
 * `$lib/publish/publish-capability.ts` (publish). Their routes
 * (`src/routes/api/{remote,sync,publish}/**`) are deleted; call those
 * modules' exports instead of `api.remote.*`/`api.sync.*`/`api.publish.*`.
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
} from './platform/contract';

import type {
  UpdaterStatus,
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

  // sync, remote deleted (SFE-P5c3) — migrated wholesale to typed IPC. See
  // `$lib/remote/remote-capability.ts`.

  // vcs deleted (SFE-P5c2) — migrated wholesale to typed IPC. See
  // `$lib/vcs/vcs-capability.ts`.

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

  // publish deleted (SFE-P5c3) — migrated wholesale to typed IPC. See
  // `$lib/publish/publish-capability.ts`.
};
