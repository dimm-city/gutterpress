/**
 * Shared app-lifecycle hooks for app:* server routes.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getAppHooks()` is a thin derived selector over it.
 * main.ts builds the `AppHooks` object and passes it as the `app` field to
 * ONE `registerHostServices()` call; server routes call `getAppHooks()` to
 * retrieve it.
 */

import { getHostServices } from './host-services';

export interface AppHooks {
  /** Set the renderer dirty state for the close gate. */
  setRendererDirty: (isDirty: boolean) => void;
  /** Resolve the pending flush and mark renderer clean. */
  resolveFlush: () => void;
  /** Send a push event to the main window's renderer. */
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

/** The live `AppHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getAppHooks(): AppHooks | null {
  return getHostServices()?.app ?? null;
}
