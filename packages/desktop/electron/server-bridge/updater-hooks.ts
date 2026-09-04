/**
 * Shared updater hooks for the updater:getStatus/check/download/applyNow IPC
 * handlers in `electron/api/updater.ts` (SFE-P5c4 — restored to IPC; through
 * SFE-P5c3 these three were plain request/response served by the deleted
 * `updater/*​/+server.ts` routes because they were plain request/response
 * with no push stream or live-BrowserWindow need — ARCH review #8).
 *
 * `electron/updater.ts`'s mutable state (phase/lastError/downloadedVersion/
 * activeAutoUpdater) lives inside main.ts's bundle, populated by the ONE
 * `initUpdater()` call there. Through SFE-P5c3, the SvelteKit handler ran in
 * a SEPARATE Vite bundle — a plain `import` of updater.ts from a route would
 * have silently bundled a SECOND, never-initialized copy of that
 * module-level state (the exact reason every other cross-bundle host
 * touch-point in this app goes through the collapsed `__gutterpressHost__`
 * object instead of a static import — see host-services.ts's module doc).
 * That constraint no longer applies now that every consumer is
 * `electron/api/updater.ts`, in main's own bundle — this module survives as
 * the one shared implementation `electron/api/updater.ts` calls, not because
 * of a bundle-isolation requirement. `getUpdaterHooks()` is the thin derived
 * selector over the collapsed host object, same pattern as every other
 * domain here.
 *
 * `applyNow` (electron/updater.ts's `installNow`) joined this bag in the
 * SFE-P6b repair round: `electron/api/updater.ts` must stay Electron-runtime
 * free like every other `electron/api/*.ts` module (it is loaded and its
 * handler bodies exercised under plain `bun test`, no Electron host present),
 * so it may only reach `installNow()`'s state through this hooks bag, never
 * via a direct top-level `import { installNow } from "../updater"` — that
 * import drags `electron/updater.ts`'s own top-level `import "electron"` in
 * with it and breaks `bun test --isolate` on any file that doesn't already
 * have a process-wide `mock.module("electron", …)` in effect.
 */

import { getHostServices } from './host-services';
import type { UpdaterStatus } from '../bridge-types';

export interface UpdaterHooks {
  /** Synchronous — mirrors electron/updater.ts's own getStatus() signature. */
  getStatus(): UpdaterStatus;
  /** User-initiated (non-silent) check — full error reporting. */
  check(): Promise<UpdaterStatus>;
  /** Download the update, or open its GitHub page on check-only macOS. */
  download(): Promise<UpdaterStatus>;
  /** Quit and install the downloaded update (electron/updater.ts's installNow()). */
  applyNow(): Promise<{ applied: boolean; version?: string; error?: string }>;
}

/** The live `UpdaterHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getUpdaterHooks(): UpdaterHooks | null {
  return getHostServices()?.updater ?? null;
}
