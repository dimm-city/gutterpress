/**
 * Shared media hooks for media:* server routes.
 */

export interface MediaHooks {
  createThumbnail: (filePath: string, maxPx: number) => Promise<string | null>;
}

const GLOBAL_KEY = '__printMdMediaHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdMediaHooks__: MediaHooks | undefined;
}

export function registerMediaHooks(hooks: MediaHooks): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getMediaHooks(): MediaHooks | null {
  return globalThis[GLOBAL_KEY] ?? null;
}
