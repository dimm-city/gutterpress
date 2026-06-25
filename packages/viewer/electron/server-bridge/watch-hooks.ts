/**
 * Shared folder-watch hooks for watch-folder/unwatch-folder server routes.
 * Same globalThis pattern as write-hooks.ts.
 */

export interface WatchHooks {
  startFolderWatch: (dir: string) => void;
  stopFolderWatch: () => void;
  getWatchedDir: () => string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __printMdWatchHooks__: WatchHooks | undefined;
}

export function registerWatchHooks(hooks: WatchHooks): void {
  globalThis.__printMdWatchHooks__ = hooks;
}
