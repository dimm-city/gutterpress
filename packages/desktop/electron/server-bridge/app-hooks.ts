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
  /** Record the renderer's best-effort dirty-state hint (never a close safety gate). */
  setRendererDirty: (isDirty: boolean) => void;
  /** Send a push event to the main window's renderer. */
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  /**
   * Append one already-formatted failure line to the app's own diagnostic
   * log (electron/app-log.ts) — the file the start screen's Logs tab shows.
   * The shared error filters (server-bridge/friendly-errors.ts) call this for
   * every failure they log, so the "See the app log for details" they promise
   * is true from the SvelteKit routes' bundle too, not only from main.ts's.
   * Optional: absent (tests, or before main.ts wires it), logging stays
   * console-only.
   */
  logFailure?: (line: string) => void;
}

/** The live `AppHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getAppHooks(): AppHooks | null {
  return getHostServices()?.app ?? null;
}
