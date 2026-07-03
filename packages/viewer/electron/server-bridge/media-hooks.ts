/**
 * Shared media hooks for media:* server routes.
 */

import { createHostBridge } from './create-host-bridge';

export interface MediaHooks {
  createThumbnail: (filePath: string, maxPx: number) => Promise<string | null>;
}

export const { register: registerMediaHooks, get: getMediaHooks } =
  createHostBridge<MediaHooks>('__printMdMediaHooks__');
