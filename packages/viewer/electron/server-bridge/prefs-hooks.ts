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

export interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
  writePrefs: (prefs: Record<string, unknown>) => Promise<void>;
  readSettings: () => Promise<Record<string, unknown>>;
  writeSettings: (settings: Record<string, unknown>) => Promise<void>;
  existingDirectory: (dir: string | undefined) => Promise<string | null>;
  readProjectState: (states: Record<string, unknown> | undefined, dir: string) => unknown;
  writeProjectState: (states: Record<string, unknown> | undefined, dir: string, patch: Record<string, unknown>) => Record<string, unknown>;
  mergeSettings: (base: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>;
  defaultProjectSearchRoots: () => string[];
  scanForProjects: (roots: string[], exclude: Set<string>) => Promise<unknown[]>;
  toggleFavoriteFolder: (
    favorites: Array<{ path: string; title: string }> | undefined,
    entry: { path: string; title: string }
  ) => { favorites: Array<{ path: string; title: string }>; favorited: boolean };
  removeRecentFolder: (
    recents: Array<{ path: string; [k: string]: unknown }> | undefined,
    targetPath: string
  ) => Array<{ path: string; [k: string]: unknown }>;
  loadLib: () => Promise<{
    detectProjectSource: (path: string) => Promise<unknown>;
    capabilitiesFor: (source: unknown) => unknown;
    scaffoldProject: (opts: unknown) => Promise<unknown>;
    adoptFolder: (opts: unknown) => Promise<unknown>;
  }>;
}

const GLOBAL_KEY = '__printMdPrefsHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdPrefsHooks__: PrefsHooks | undefined;
}

export function registerPrefsHooks(hooks: PrefsHooks): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getPrefsHooks(): PrefsHooks | null {
  return globalThis[GLOBAL_KEY] ?? null;
}
