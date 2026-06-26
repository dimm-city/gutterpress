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

export interface WriteHooks {
  scheduleAutoSnapshot: (dir: string) => void;
  scheduleAutoSync: (dir: string) => void;
  getWatchedDir: () => string | null;
}

const GLOBAL_KEY = '__printMdWriteHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdWriteHooks__: WriteHooks | undefined;
}

export function registerWriteHooks(hooks: WriteHooks): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getWriteHooks(): WriteHooks | null {
  return globalThis[GLOBAL_KEY] ?? null;
}
