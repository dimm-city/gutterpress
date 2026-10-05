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
 * through the collapsed `__gutterpressHost__` object instead of a static import
 * — see host-services.ts's module doc). Routes reach it through
 * `getHostServices().updater`.
 */

import type { UpdaterStatus } from '../../src/lib/platform/shared-types';

export interface UpdaterHooks {
  /** Synchronous — mirrors electron/updater.ts's own getStatus() signature. */
  getStatus(): UpdaterStatus;
  /** User-initiated (non-silent) check — full error reporting. */
  check(): Promise<UpdaterStatus>;
  /** Download the update, or open its GitHub page on check-only macOS. */
  download(): Promise<UpdaterStatus>;
}
