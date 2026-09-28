/**
 * Shared prefs/settings hooks for the `app:*` typed IPC channels
 * (`electron/api/app.ts`, `electron/api/git-identity-args.ts`).
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getPrefsHooks()` is a thin derived selector over
 * it. main.ts builds ONE concrete `PrefsHooks<LibModule, DesktopPrefs,
 * AppSettings, ProjectStateMap | undefined, RecentFolder>` object and passes
 * it as the `prefs` field to a single `registerHostServices()` call.
 *
 * `getPrefsHooks<...>()` keeps its own generic parameters so call sites can
 * ask for a narrower view (e.g. `getPrefsHooks<ProjectSourceLibModule>()`) —
 * that's a safe, intentional narrowing at the point of USE, unlike the old
 * per-hook registration's `as`-cast at the point of REGISTRATION, which threw
 * real type information away before it ever reached the seam.
 */

import { getHostServices } from './host-services';

export interface PrefsHooks<
  LibModule = unknown,
  Prefs = Record<string, unknown>,
  Settings = Record<string, unknown>,
  ProjectStates = Record<string, unknown> | undefined,
  RecentFolderEntry extends { path: string } = { path: string; [k: string]: unknown },
> {
  readPrefs: () => Promise<Prefs>;
  writePrefs: (prefs: Prefs) => Promise<void>;
  /**
   * Atomic read-modify-write on the prefs store's write queue. Use this for
   * every patch-style mutation — a bare readPrefs()+writePrefs() pair races
   * the other prefs writers (api:preview's recents stamp, the start screen's
   * startup toggle) and silently reverts their changes.
   */
  updatePrefs: (mutate: (prefs: Prefs) => Prefs) => Promise<Prefs>;
  readSettings: () => Promise<Settings>;
  // writeSettings/mergeSettings were removed from this seam (review finding):
  // after the app/settings POST route moved to updateSettings, no route
  // consumed them — and advertising the racy read+merge+write building blocks
  // here invites reintroducing the exact lost-update audit A2 fixed. The store
  // still has writeSettings internally; routes get only the atomic op.
  /**
   * Atomic read-merge-write of a settings patch on the store's write queue
   * (audit A2): the only way a route mutates settings.
   */
  updateSettings: (patch: Record<string, unknown>) => Promise<Settings>;
  existingDirectory: (dir: string | undefined) => Promise<string | null>;
  readProjectState: (states: ProjectStates, dir: string) => unknown;
  writeProjectState: (states: ProjectStates, dir: string, patch: Record<string, unknown>) => ProjectStates;
  defaultProjectSearchRoots: () => string[];
  scanForProjects: (roots: string[], exclude: Set<string>) => Promise<unknown[]>;
  toggleFavoriteFolder: (
    favorites: Array<{ path: string; title: string }> | undefined,
    entry: { path: string; title: string }
  ) => { favorites: Array<{ path: string; title: string }>; favorited: boolean };
  removeRecentFolder: (
    recents: RecentFolderEntry[] | undefined,
    targetPath: string
  ) => RecentFolderEntry[];
  loadLib: () => Promise<LibModule>;
}

/**
 * The live `PrefsHooks` slice of the collapsed host object, narrowed to
 * whatever generic view the caller asks for. The cast here is the same
 * "downcast to a narrower view" every call site already relied on before
 * #31 — it is unrelated to (and does not reintroduce) the registration-side
 * cast the ARCH review flagged, which has been eliminated: `host-services.ts`
 * now stores the REAL concrete types, so `registerHostServices()` itself
 * needs no cast at all.
 */
export function getPrefsHooks<
  LibModule = unknown,
  Prefs = Record<string, unknown>,
  Settings = Record<string, unknown>,
  ProjectStates = Record<string, unknown> | undefined,
  RecentFolderEntry extends { path: string } = { path: string; [k: string]: unknown },
>(): PrefsHooks<LibModule, Prefs, Settings, ProjectStates, RecentFolderEntry> | null {
  const prefs = getHostServices()?.prefs;
  return (
    (prefs as unknown as
      | PrefsHooks<LibModule, Prefs, Settings, ProjectStates, RecentFolderEntry>
      | undefined) ?? null
  );
}
