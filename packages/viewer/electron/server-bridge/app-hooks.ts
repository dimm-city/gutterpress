/**
 * Shared app-lifecycle hooks for app:* server routes.
 *
 * The SvelteKit handler and main.ts run in the same Node.js process but in
 * separate Vite bundles. We use globalThis to share live references so the
 * server routes can call main-process lifecycle functions.
 *
 * main.ts calls registerAppHooks() once at startup.
 * Server routes call getAppHooks() to retrieve them.
 */

import { createHostBridge } from './create-host-bridge';

export interface AppHooks {
  /** Drive the splash window status line / progress bar. */
  updateSplash: (status?: string, progress?: number, sub?: string) => void;
  /** Reveal the main window and dismiss the splash (idempotent). */
  showMainWindowAndCloseSplash: () => void;
  /** Set the renderer dirty state for the close gate. */
  setRendererDirty: (isDirty: boolean) => void;
  /** Resolve the pending flush and mark renderer clean. */
  resolveFlush: () => void;
  /** Send a push event to the main window's renderer. */
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

export const { register: registerAppHooks, get: getAppHooks } =
  createHostBridge<AppHooks>('__printMdAppHooks__');
