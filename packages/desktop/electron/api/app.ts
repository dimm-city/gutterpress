/**
 * App-lifecycle operations (prefs, project state, settings, native theme,
 * recents/favorites, discovery/classification/scaffolding, dirty-state,
 * flush-failure marker, AppImage menu integration) for the "app lifecycle /
 * diagnostics" IPC capability (SFE-P5c1).
 *
 * Ports `src/routes/api/app/**​/+server.ts` verbatim — same hook calls
 * (`getPrefsHooks`/`getDesktopHooks`/`getAppHooks`/`getAppImageHooks`), same
 * validation, same atomic read-modify-write discipline on the prefs/settings
 * store (`updatePrefs`/`updateSettings` — never a bare read+write pair, which
 * used to race concurrent writers, audit A2).
 */
import { getAppHooks } from "../server-bridge/app-hooks";
import { getAppImageHooks, getDesktopHooks } from "../server-bridge/host-hooks";
import { getPrefsHooks, type PrefsHooks } from "../server-bridge/prefs-hooks";
import { friendlyAppImageError } from "../server-bridge/friendly-errors";
import { requireAbsolute } from "./validation";
import type {
  AppImageInstallResult,
  AppImageRemoveResult,
  AppImageStatus,
} from "../appimage-integration";
import type {
  DiscoveredProject,
  ProjectClassification,
  ProjectClassificationBook,
} from "../../src/lib/platform/dtos";
import type { DesktopPrefs, LastFlushFailure, ProjectState } from "../../src/lib/platform/shared-types";
import { createLastFlushFailure } from "../../src/lib/persistence-failures";

function prefsHooks(): PrefsHooks {
  const h = getPrefsHooks();
  if (!h) throw new Error("Prefs hooks not registered");
  return h;
}

function desktopHooks() {
  const h = getDesktopHooks();
  if (!h) throw new Error("Desktop hooks not registered");
  return h;
}

// ── Prefs / project state / settings ────────────────────────────────────────

/** Get desktop prefs (lastProjectDir, recentFolders, projectStates, etc.). */
export async function appGetDesktopPrefs(): Promise<DesktopPrefs> {
  const hooks = prefsHooks();
  const prefs = await hooks.readPrefs();
  const lastProjectDir = await hooks.existingDirectory(
    (prefs as { lastProjectDir?: string }).lastProjectDir,
  );
  return { ...(prefs as DesktopPrefs), lastProjectDir };
}

/** Shallow-merge patch into desktop prefs. Atomic read-modify-write — races
 *  the open-project flow's own recents/lastProjectDir stamp otherwise. */
export async function appSetDesktopPrefs(patch: Record<string, unknown>): Promise<{ ok: true }> {
  await prefsHooks().updatePrefs((current) => ({ ...current, ...patch }));
  return { ok: true };
}

/** Get per-project editor/preview state for the given projectDir. */
export async function appGetDesktopProjectState(rawProjectDir: unknown): Promise<ProjectState | null> {
  const projectDir = requireAbsolute(rawProjectDir, "app/gutterpress-project-state:get");
  const hooks = prefsHooks();
  const prefs = await hooks.readPrefs();
  const state = hooks.readProjectState(
    (prefs as { projectStates?: Record<string, unknown> }).projectStates,
    projectDir,
  );
  return (state as ProjectState | undefined) ?? null;
}

/** Set per-project editor/preview state for the given projectDir. */
export async function appSetDesktopProjectState(
  rawProjectDir: unknown,
  rawState: unknown,
): Promise<{ ok: true }> {
  const projectDir = requireAbsolute(rawProjectDir, "app/gutterpress-project-state:set");
  const state = (rawState ?? {}) as Record<string, unknown>;
  const hooks = prefsHooks();
  await hooks.updatePrefs((current) => ({
    ...current,
    lastProjectDir: projectDir,
    projectStates: hooks.writeProjectState(
      (current as { projectStates?: Record<string, unknown> }).projectStates,
      projectDir,
      state,
    ),
  }));
  return { ok: true };
}

/** Get app settings (merged with defaults). */
export async function appGetSettings(): Promise<Record<string, unknown>> {
  return prefsHooks().readSettings();
}

/** Deep-merge patch into app settings. Atomic read-merge-write (audit A2). */
export async function appSetSettings(patch: Record<string, unknown>): Promise<{ ok: true }> {
  await prefsHooks().updateSettings(patch);
  return { ok: true };
}

/** Get the OS native dark/light theme preference. */
export async function appGetNativeTheme(): Promise<{ shouldUseDarkColors: boolean }> {
  return desktopHooks().getNativeTheme();
}

/** Get the recent folders list (with `exists` flags, `lastActiveBook`-aware —
 *  see the deleted route's comment for why both paths are checked). */
export async function appGetRecentFolders(): Promise<
  Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>
> {
  const hooks = prefsHooks();
  const prefs = await hooks.readPrefs();
  const recents =
    ((prefs as { recentFolders?: Array<{ path: string; title: string; lastActiveBook?: string }> })
      .recentFolders) ?? [];
  return Promise.all(
    recents.map(async (r) => {
      const repoExists = (await hooks.existingDirectory(r.path)) !== null;
      if (!repoExists) return { ...r, exists: false } as (typeof recents)[number] & { exists: boolean };
      if (!r.lastActiveBook) return { ...r, exists: true };
      const bookExists = (await hooks.existingDirectory(r.lastActiveBook)) !== null;
      if (bookExists) return { ...r, exists: true };
      const { lastActiveBook: _dropped, ...rest } = r;
      return { ...rest, exists: true };
    }),
  );
}

/** Get the favorites list (with `exists` flags). */
export async function appGetFavorites(): Promise<Array<{ path: string; title: string; exists: boolean }>> {
  const hooks = prefsHooks();
  const prefs = await hooks.readPrefs();
  const favorites =
    ((prefs as { favorites?: Array<{ path: string; title: string }> }).favorites) ?? [];
  return Promise.all(
    favorites.map(async (f) => ({ ...f, exists: (await hooks.existingDirectory(f.path)) !== null })),
  );
}

/** Toggle a folder in the favorites list. */
export async function appToggleFavorite(rawPath: unknown, rawTitle: unknown): Promise<{ favorited: boolean }> {
  if (!rawPath || typeof rawPath !== "string") throw new Error("path is required");
  const path = rawPath;
  const title = typeof rawTitle === "string" ? rawTitle : "";
  const hooks = prefsHooks();
  let favorited = false;
  await hooks.updatePrefs((current) => {
    const result = hooks.toggleFavoriteFolder(
      (current as { favorites?: Array<{ path: string; title: string }> }).favorites,
      { path, title },
    );
    favorited = result.favorited;
    return { ...current, favorites: result.favorites };
  });
  return { favorited };
}

/** Remove a folder from the recent list. */
export async function appRemoveRecent(rawPath: unknown): Promise<{ ok: true }> {
  if (!rawPath || typeof rawPath !== "string") throw new Error("path is required");
  const hooks = prefsHooks();
  await hooks.updatePrefs((current) => ({
    ...current,
    recentFolders: hooks.removeRecentFolder(
      (current as { recentFolders?: Array<{ path: string }> }).recentFolders,
      rawPath,
    ),
  }));
  return { ok: true };
}

// ── Discovery / classification / scaffolding ────────────────────────────────

interface ProjectSourceLibModule {
  detectProjectSource: (path: string) => Promise<unknown>;
  capabilitiesFor: (source: unknown) => unknown;
  repoSubPath: (repoRoot: string, folderPath: string) => string;
  hasProjectManifest: (folderPath: string) => boolean;
}

/** Discover Gutterpress projects under the configured search roots,
 *  excluding folders (and their `lastActiveBook`) already in Recents or
 *  Favorites. A scan failure propagates rather than resolving `[]` — M20:
 *  otherwise indistinguishable from "no projects found". */
export async function appDiscoverProjects(): Promise<DiscoveredProject[]> {
  const hooks = prefsHooks();
  const prefs = await hooks.readPrefs();
  const searchRoots = (prefs as { projectSearchRoots?: string[] }).projectSearchRoots;
  const roots = searchRoots && searchRoots.length > 0 ? searchRoots : hooks.defaultProjectSearchRoots();
  const recentFolders = (prefs as { recentFolders?: Array<{ path: string; lastActiveBook?: string }> })
    .recentFolders;
  const favorites = (prefs as { favorites?: Array<{ path: string }> }).favorites;
  const exclude = new Set<string>([
    ...(recentFolders ?? []).flatMap((r) => (r.lastActiveBook ? [r.path, r.lastActiveBook] : [r.path])),
    ...(favorites ?? []).map((f) => f.path),
  ]);
  return (await hooks.scanForProjects(roots, exclude)) as DiscoveredProject[];
}

/** Classify a project folder (source type + capabilities + repo book list —
 *  C1: a `local-git-folder`'s repo root may hold several books). */
export async function appClassifyProject(rawProjectDir: unknown): Promise<ProjectClassification> {
  const projectDir = requireAbsolute(rawProjectDir, "app/classify-project");
  const hooks = getPrefsHooks<ProjectSourceLibModule>();
  if (!hooks) throw new Error("Prefs hooks not registered");
  const lib = await hooks.loadLib();
  const source = await lib.detectProjectSource(projectDir);
  const capabilities = lib.capabilitiesFor(source);
  const hasManifest = lib.hasProjectManifest(projectDir);

  const typedSource = source as { type: string; repoRoot?: string };
  let repoRoot: string | undefined;
  let books: ProjectClassificationBook[] | undefined;
  if (typedSource.type === "local-git-folder" && typedSource.repoRoot) {
    repoRoot = typedSource.repoRoot;
    const discovered = (await hooks.scanForProjects([repoRoot], new Set())) as Array<{
      path: string;
      title: string;
    }>;
    books = discovered
      .map((d) => ({ ...d, subPath: lib.repoSubPath(repoRoot!, d.path) }))
      .sort((a, b) => (a.subPath < b.subPath ? -1 : a.subPath > b.subPath ? 1 : 0));
  }

  return { source, capabilities, hasManifest, repoRoot, books } as ProjectClassification;
}

/** Scaffold a new project from a template. */
export async function appCreateProject(rawOptions: unknown): Promise<unknown> {
  const options = rawOptions as Record<string, unknown> | null;
  if (!options || typeof options.name !== "string" || typeof options.parentDir !== "string") {
    throw new Error("createProject requires { name, parentDir }");
  }
  const hooks = getPrefsHooks<{ scaffoldProject: (opts: unknown) => Promise<unknown> }>();
  if (!hooks) throw new Error("Prefs hooks not registered");
  const lib = await hooks.loadLib();
  return lib.scaffoldProject(options);
}

/** Adopt an existing folder as a Gutterpress project. */
export async function appAdoptFolder(rawOptions: unknown): Promise<unknown> {
  const options = rawOptions as Record<string, unknown>;
  requireAbsolute(options?.dir, "adoptFolder");
  const hooks = getPrefsHooks<{ adoptFolder: (opts: unknown) => Promise<unknown> }>();
  if (!hooks) throw new Error("Prefs hooks not registered");
  const lib = await hooks.loadLib();
  return lib.adoptFolder(options);
}

// ── Dirty-state / flush-failure marker ──────────────────────────────────────

/** Push a best-effort dirty-state hint; close still requests a direct flush. */
export function appSetDirtyState(dirty: unknown): { ok: true } {
  getAppHooks()?.setRendererDirty(Boolean(dirty));
  return { ok: true };
}

/** Persist a failed editor-buffer flush marker in the atomic prefs store. */
export async function appRecordFlushFailure(rawProjectDir: unknown): Promise<LastFlushFailure> {
  const projectDir =
    rawProjectDir == null ? null : requireAbsolute(rawProjectDir, "app/flush-failure:record");
  const marker = createLastFlushFailure(projectDir);
  await prefsHooks().updatePrefs((current) => ({ ...current, lastFlushFailed: marker }));
  return marker;
}

/** Clear exactly the marker that was surfaced, without racing a newer failure. */
export async function appAcknowledgeFlushFailure(rawFailedAt: unknown): Promise<{ acknowledged: boolean }> {
  if (typeof rawFailedAt !== "string" || !rawFailedAt) {
    throw new Error("app/flush-failure requires record or acknowledge details");
  }
  let acknowledged = false;
  await prefsHooks().updatePrefs((current) => {
    const typed = current as { lastFlushFailed?: LastFlushFailure };
    if (typed.lastFlushFailed?.failedAt !== rawFailedAt) return current;
    acknowledged = true;
    const next = { ...current } as { lastFlushFailed?: LastFlushFailure };
    delete next.lastFlushFailed;
    return next;
  });
  return { acknowledged };
}

// ── Linux AppImage application-menu integration (#119) ──────────────────────
// Fixed-argument by design: no path input — the managed destinations are
// computed host-side from the real home directory / $XDG_DATA_HOME.

function appImageHooks() {
  const h = getAppImageHooks();
  if (!h) throw new Error("AppImage integration hooks not registered");
  return h;
}

// `friendlyAppImageError` maps ONLY a failure from the operation itself
// (install()/remove() throwing a raw fs error) — never the "hooks not
// registered" host-disconnected case. The deleted POST route's `onError`
// worked the same way: `defineRoute`'s hooks-availability check threw a
// SvelteKit `HttpError` directly, which `jsonRoute` propagates unchanged,
// BYPASSING `onError` entirely (see the deleted `_lib/handler.ts`'s
// `jsonRoute` doc comment) — only a throw from inside `call` (the real
// install()/remove() work) ever reached the friendly-error classifier.
// Wrapping the hooks lookup itself would mangle "AppImage integration hooks
// not registered" into the generic "could not be updated" message.
async function withFriendlyAppImageError<T>(logLabel: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new Error(friendlyAppImageError(e, logLabel).message);
  }
}

export async function appImageIntegrationStatus(): Promise<AppImageStatus> {
  return appImageHooks().getStatus();
}

export async function appImageIntegrationInstall(): Promise<AppImageInstallResult> {
  const hooks = appImageHooks();
  return withFriendlyAppImageError("app/appimage-integration", () => hooks.install());
}

export async function appImageIntegrationRemove(): Promise<AppImageRemoveResult> {
  const hooks = appImageHooks();
  return withFriendlyAppImageError("app/appimage-integration", () => hooks.remove());
}
