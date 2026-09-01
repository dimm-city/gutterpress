/**
 * App-lifecycle capability (SFE-P5b, extended SFE-P5c1, D10's named bounded
 * context "app lifecycle (flush/close, folder events, file launch)").
 * Replaces the corresponding `getPlatform()` members consumed by
 * `FileTree.svelte`, `MediaPanel.svelte`, and `+page.svelte` (SFE-P5b), and
 * (SFE-P5c1) `api.log.*`/`api.app.*` (deleted `src/routes/api/{log,app}/**`
 * HTTP routes) — `log` per the capability map's own read ("app lifecycle /
 * diagnostics") and `app` (prefs/settings/dirty-state/discovery/AppImage
 * integration) as the plan's own P5c1 scoping note: "kept whole here — its
 * settings/prefs/dirty-state/discovery members are one bounded context;
 * splitting one namespace across subruns is worse."
 *
 * The original four members are real 1:1 delegation to the preload bridge
 * (push subscriptions / a request+push pair) — grouped into one module
 * because they share D10's one named bounded context across three consumer
 * files: `onFolderChanged` has two real consumers (`FileTree.svelte`,
 * `MediaPanel.svelte`) that share the same "why we need the bridge"
 * reasoning, and the module's other three members (`onFlushBeforeClose`,
 * `onOpenMarkdownFile`, `watchFolder`) are consumed by `+page.svelte` — one
 * module writes that reasoning down once for the whole bounded context
 * instead of scattering it across call-site files.
 *
 * Error semantics (run rule 2): every `log`/`app` function scrubs the
 * Electron IPC transport prefix (`friendlyHostError`) off a rejection's
 * message before re-throwing — same rationale as
 * `$lib/files/files-capability.ts`'s header.
 */
import { bridge } from "$lib/platform/bridge";
import { friendlyHostError } from "$lib/errors";
import type {
  AppImageIntegrationInstallResult,
  AppImageIntegrationRemoveResult,
  AppImageIntegrationStatus,
  DiscoveredProject,
  LogFileEntry,
  ProjectClassification,
} from "$lib/platform/dtos";
import type {
  CreateProjectResult,
  DesktopPrefs,
  FolderChangedEvent,
  LastFlushFailure,
  MarkdownFileLaunchEvent,
  ProjectState,
} from "$lib/platform/contract";

async function call<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    throw new Error(friendlyHostError(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * Subscribe to debounced folder-change notifications for the open project
 * (#44), backing external-edit detection. Returns an unsubscribe fn.
 */
export function onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void {
  return bridge().onFolderChanged(cb);
}

/**
 * Subscribe to the main process's request to flush before the window closes
 * (#44). Returning false reports that the buffer did not reach disk; main
 * records the durable failure marker and still closes after bounded waits.
 */
export function onFlushBeforeClose(cb: () => boolean | void | Promise<boolean | void>): () => void {
  return bridge().onFlushBeforeClose(cb);
}

/**
 * Subscribe to `.md` launches from the desktop shell. Initial paths are
 * replayed before a `ready` sentinel; later Finder/Explorer launches stream
 * through the same callback.
 */
export function onOpenMarkdownFile(cb: (event: MarkdownFileLaunchEvent) => void): () => void {
  return bridge().onOpenMarkdownFile(cb);
}

/** Raw folder-watch IPC (#44). Subscribes to change events for `path`. */
export function watchFolder(path: string, cb: () => void): () => void {
  return bridge().watchFolder(path, cb);
}

// ── log (SFE-P5c1) ───────────────────────────────────────────────────────

/** Read an operation log file. Returns null when the file doesn't exist. */
export async function readLog(logPath: string): Promise<string | null> {
  return call(bridge().log.read(logPath));
}

/** List the app's diagnostic log files (newest first). */
export async function listLogs(): Promise<LogFileEntry[]> {
  return call(bridge().log.list());
}

// ── app (SFE-P5c1) ───────────────────────────────────────────────────────

/** Get desktop prefs (lastProjectDir, recentFolders, projectStates, etc.). */
export async function getDesktopPrefs(): Promise<DesktopPrefs> {
  return call(bridge().app.getDesktopPrefs());
}

/** Shallow-merge patch into desktop prefs. */
export async function setDesktopPrefs(prefs: Record<string, unknown>): Promise<{ ok: true }> {
  return call(bridge().app.setDesktopPrefs(prefs));
}

/** Get per-project editor/preview state for the given projectDir. */
export async function getDesktopProjectState(projectDir: string): Promise<ProjectState | null> {
  return call(bridge().app.getDesktopProjectState(projectDir));
}

/** Set per-project editor/preview state for the given projectDir. */
export async function setDesktopProjectState(
  projectDir: string,
  state: Record<string, unknown>,
): Promise<{ ok: true }> {
  return call(bridge().app.setDesktopProjectState(projectDir, state));
}

/** Get app settings (merged with defaults). */
export async function getSettings(): Promise<Record<string, unknown>> {
  return call(bridge().app.getSettings());
}

/** Deep-merge patch into app settings. */
export async function setSettings(settings: Record<string, unknown>): Promise<{ ok: true }> {
  return call(bridge().app.setSettings(settings));
}

/** Get the OS native dark/light theme preference. */
export async function getNativeTheme(): Promise<{ shouldUseDarkColors: boolean }> {
  return call(bridge().app.getNativeTheme());
}

/** Get the recent folders list (with `exists` flag). `lastActiveBook` is the
 *  absolute folder of the book that was active when a repo-backed entry was
 *  recorded — absent for standalone (non-git) entries. */
export async function getRecentFolders(): Promise<
  Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>
> {
  return call(bridge().app.getRecentFolders());
}

/** Get the favorites list (with `exists` flag). */
export async function getFavorites(): Promise<Array<{ path: string; title: string; exists: boolean }>> {
  return call(bridge().app.getFavorites());
}

/** Toggle a folder in the favorites list. */
export async function toggleFavorite(path: string, title: string): Promise<{ favorited: boolean }> {
  return call(bridge().app.toggleFavorite(path, title));
}

/** Remove a folder from the recent list. */
export async function removeRecent(path: string): Promise<{ ok: true }> {
  return call(bridge().app.removeRecent(path));
}

/** Discover Gutterpress projects under the configured search roots. */
export async function discoverProjects(): Promise<DiscoveredProject[]> {
  return call(bridge().app.discoverProjects());
}

/** Classify a project folder (source type + capabilities + repo book list). */
export async function classifyProject(projectDir: string): Promise<ProjectClassification> {
  return call(bridge().app.classifyProject(projectDir));
}

/** Scaffold a new project from a template. */
export async function createProject(options: Record<string, unknown>): Promise<CreateProjectResult> {
  return call(bridge().app.createProject(options));
}

/** Adopt an existing folder as a Gutterpress project. */
export async function adoptFolder(options: Record<string, unknown>): Promise<CreateProjectResult> {
  return call(bridge().app.adoptFolder(options));
}

/** Push a best-effort dirty-state hint; close still requests a direct flush. */
export async function setDirtyState(dirty: boolean): Promise<{ ok: true }> {
  return call(bridge().app.setDirtyState(dirty));
}

/** Persist a failed editor-buffer flush marker in the atomic desktop prefs store. */
export async function recordFlushFailure(projectDir: string | null): Promise<LastFlushFailure> {
  return call(bridge().app.recordFlushFailure(projectDir));
}

/** Clear exactly the marker that was surfaced, without racing a newer failure. */
export async function acknowledgeFlushFailure(failedAt: string): Promise<{ acknowledged: boolean }> {
  return call(bridge().app.acknowledgeFlushFailure(failedAt));
}

/**
 * Linux AppImage application-menu integration (#119). `getStatus()` is safe
 * to call on every platform — off-Linux, in dev, or outside an AppImage it
 * reports `supported: false` with a reason.
 */
export const appImageIntegration = {
  getStatus(): Promise<AppImageIntegrationStatus> {
    return call(bridge().app.appImageIntegration.getStatus());
  },
  install(): Promise<AppImageIntegrationInstallResult> {
    return call(bridge().app.appImageIntegration.install());
  },
  remove(): Promise<AppImageIntegrationRemoveResult> {
    return call(bridge().app.appImageIntegration.remove());
  },
};
