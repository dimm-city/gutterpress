/**
 * Shared prefs/settings hooks for app:* server routes.
 *
 * The SvelteKit handler and main.ts run in the same Node.js process but in
 * separate Vite bundles. We use globalThis to share live references so the
 * server routes can call the prefs/settings read/write logic that lives in main.
 *
 * main.ts calls registerPrefsHooks() once at startup.
 * Server routes call getPrefsHooks() to retrieve them.
 */

export interface PrefsHooks<
  LibModule = unknown,
  Prefs = Record<string, unknown>,
  Settings = Record<string, unknown>,
  ProjectStates = Record<string, unknown> | undefined,
  RecentFolderEntry extends { path: string } = { path: string; [k: string]: unknown },
> {
  readPrefs: () => Promise<Prefs>;
  writePrefs: (prefs: Prefs) => Promise<void>;
  readSettings: () => Promise<Settings>;
  writeSettings: (settings: Settings) => Promise<void>;
  existingDirectory: (dir: string | undefined) => Promise<string | null>;
  readProjectState: (states: ProjectStates, dir: string) => unknown;
  writeProjectState: (states: ProjectStates, dir: string, patch: Record<string, unknown>) => ProjectStates;
  mergeSettings: (base: Settings, patch: Record<string, unknown>) => Settings;
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

const GLOBAL_KEY = '__printMdPrefsHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdPrefsHooks__: unknown;
}

export function registerPrefsHooks<
  LibModule,
  Prefs,
  Settings,
  ProjectStates,
  RecentFolderEntry extends { path: string },
>(hooks: PrefsHooks<LibModule, Prefs, Settings, ProjectStates, RecentFolderEntry>): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getPrefsHooks<
  LibModule = unknown,
  Prefs = Record<string, unknown>,
  Settings = Record<string, unknown>,
  ProjectStates = Record<string, unknown> | undefined,
  RecentFolderEntry extends { path: string } = { path: string; [k: string]: unknown },
>(): PrefsHooks<LibModule, Prefs, Settings, ProjectStates, RecentFolderEntry> | null {
  return (
    globalThis[GLOBAL_KEY] as
      | PrefsHooks<LibModule, Prefs, Settings, ProjectStates, RecentFolderEntry>
      | undefined
  ) ?? null;
}
