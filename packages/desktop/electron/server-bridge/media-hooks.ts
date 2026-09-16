/**
 * Shared media hooks for the `media:*` typed IPC channels
 * (`electron/api/media.ts`).
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getMediaHooks()` is a thin derived selector over it.
 */

import { getHostServices } from './host-services';

export interface MediaHooks {
  createThumbnail: (filePath: string, maxPx: number) => Promise<string | null>;
}

/** The live `MediaHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getMediaHooks(): MediaHooks | null {
  return getHostServices()?.media ?? null;
}
