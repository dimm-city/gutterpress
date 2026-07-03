/**
 * Shared folder-watch hooks for watch-folder/unwatch-folder server routes.
 * Same globalThis pattern as write-hooks.ts.
 */

import { createHostBridge } from './create-host-bridge';

export interface WatchHooks {
  startFolderWatch: (dir: string) => void;
  stopFolderWatch: () => void;
  getWatchedDir: () => string | null;
}

export const { register: registerWatchHooks, get: getWatchHooks } =
  createHostBridge<WatchHooks>('__printMdWatchHooks__');
