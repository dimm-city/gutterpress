/**
 * Shared updater hooks for the updater:getStatus/check/download server routes
 * (ARCH review #8 — migrated off IPC; they were plain request/response with
 * no push stream or live-BrowserWindow need).
 *
 * `electron/updater.ts`'s mutable state (phase/lastError/downloadedVersion/
 * activeAutoUpdater) lives inside main.ts's bundle, populated by the ONE
 * `initUpdater()` call there. Routes run in the SvelteKit handler's SEPARATE
 * Vite bundle — a plain `import` of updater.ts from a route would silently
 * bundle a SECOND, never-initialized copy of that module-level state (the
 * exact reason every other cross-bundle host touch-point in this app goes
 * through the collapsed `__printMdHost__` object instead of a static import
 * — see host-services.ts's module doc). `getUpdaterHooks()` is the thin
 * derived selector over it, same pattern as every other domain here.
 */

import { getHostServices } from './host-services';
import type { UpdaterStatus } from '../bridge-types';

export interface UpdaterHooks {
  /** Synchronous — mirrors electron/updater.ts's own getStatus() signature. */
  getStatus(): UpdaterStatus;
  /** User-initiated (non-silent) check — full error reporting. */
  check(): Promise<UpdaterStatus>;
  /** Download the update found by the last check. */
  download(): Promise<UpdaterStatus>;
}

/** The live `UpdaterHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getUpdaterHooks(): UpdaterHooks | null {
  return getHostServices()?.updater ?? null;
}
