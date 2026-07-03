import path from 'node:path';
import { getWatchHooks } from '../../../../../electron/server-bridge/watch-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { path?: string }) => {
  const dirPath = body.path;
  const hooks = getWatchHooks();
  if (hooks) {
    const watchedDir = hooks.getWatchedDir();
    if (dirPath && path.isAbsolute(dirPath)) {
      const normalized = path.resolve(dirPath);
      if (watchedDir === normalized) hooks.stopFolderWatch();
    }
  }
  return { ok: true };
});
