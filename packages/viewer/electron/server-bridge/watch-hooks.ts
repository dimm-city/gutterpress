/**
 * Shared folder-watch hooks for watch-folder/unwatch-folder server routes.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getWatchHooks()` is a thin derived selector over
 * it. Same pattern as write-hooks.ts.
 */

import { getHostServices } from './host-services';

export interface WatchHooks {
  startFolderWatch: (dir: string) => void;
  stopFolderWatch: () => void;
  getWatchedDir: () => string | null;
}

/** The live `WatchHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getWatchHooks(): WatchHooks | null {
  return getHostServices()?.watch ?? null;
}
