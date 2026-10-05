/**
 * Shared prefs/settings hooks for app:* server routes. main.ts builds ONE
 * `PrefsHooks` object and passes it as the `prefs` field to
 * `registerHostServices()`; routes reach it through `getHostServices().prefs`
 * (`./host-services.ts`). The lib itself comes from `loadLib()` in
 * `src/routes/api/_lib/route.ts`.
 */

import type { DesktopPrefs } from '../prefs-store';
import type { AppSettings } from '../settings-store';
import type { ProjectStateMap } from '../project-state';
import type { RecentFolder } from '../recent-folders';

export interface PrefsHooks {
  readPrefs: () => Promise<DesktopPrefs>;
  /**
   * Atomic read-modify-write on the prefs store's write queue. Use this for
   * every patch-style mutation — a bare read+write pair races the other prefs
   * writers (api:preview's recents stamp, the start screen's startup toggle)
   * and silently reverts their changes.
   */
  updatePrefs: (mutate: (prefs: DesktopPrefs) => DesktopPrefs) => Promise<DesktopPrefs>;
  readSettings: () => Promise<AppSettings>;
  /**
   * Atomic read-merge-write of a settings patch on the store's write queue
   * — the only way a route mutates settings.
   */
  updateSettings: (patch: Record<string, unknown>) => Promise<AppSettings>;
  existingDirectory: (dir: string | undefined) => Promise<string | null>;
  readProjectState: (states: ProjectStateMap | undefined, dir: string) => unknown;
  writeProjectState: (
    states: ProjectStateMap | undefined,
    dir: string,
    patch: Record<string, unknown>,
  ) => ProjectStateMap | undefined;
  defaultProjectSearchRoots: () => string[];
  scanForProjects: (roots: string[], exclude: Set<string>) => Promise<unknown[]>;
  toggleFavoriteFolder: (
    favorites: Array<{ path: string; title: string }> | undefined,
    entry: { path: string; title: string }
  ) => { favorites: Array<{ path: string; title: string }>; favorited: boolean };
  removeRecentFolder: (recents: RecentFolder[] | undefined, targetPath: string) => RecentFolder[];
}
