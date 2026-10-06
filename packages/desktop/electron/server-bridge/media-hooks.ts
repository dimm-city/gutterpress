/**
 * Shared media hooks for media:* server routes.
 * Routes reach them through `getHostServices().media` (`./host-services.ts`).
 */

export interface MediaHooks {
  createThumbnail: (filePath: string, maxPx: number) => Promise<string | null>;
}
