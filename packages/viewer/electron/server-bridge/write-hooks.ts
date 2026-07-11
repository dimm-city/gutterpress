/**
 * Shared write-side-effect hooks for fs:writeFile server route.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getWriteHooks()` is a thin derived selector over
 * it, retrieving the live reference the route uses to trigger the
 * auto-snapshot/sync debounce that lives in main.
 */

import { getHostServices } from './host-services';

export interface WriteHooks {
  scheduleAutoSnapshot: (dir: string) => void;
  scheduleAutoSync: (dir: string) => void;
  getWatchedDir: () => string | null;
}

/** The live `WriteHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getWriteHooks(): WriteHooks | null {
  return getHostServices()?.write ?? null;
}
