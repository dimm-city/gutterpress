/**
 * Shared write-side-effect hooks for fs:writeFile server route.
 *
 * The SvelteKit handler and main.ts run in the same Node.js process but in
 * separate Vite bundles. We use globalThis to share a live reference so the
 * server route can trigger the auto-snapshot/sync debounce that lives in main.
 *
 * main.ts calls registerWriteHooks() once at startup.
 * The server route calls getWriteHooks() to retrieve them.
 */

import { createHostBridge } from './create-host-bridge';

export interface WriteHooks {
  scheduleAutoSnapshot: (dir: string) => void;
  scheduleAutoSync: (dir: string) => void;
  getWatchedDir: () => string | null;
}

export const { register: registerWriteHooks, get: getWriteHooks } =
  createHostBridge<WriteHooks>('__printMdWriteHooks__');
