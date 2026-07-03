import { error } from '@sveltejs/kit';
import { getWatchHooks } from '../../../../../electron/server-bridge/watch-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { path?: string }) => {
  const dirPath = body.path;
  if (!dirPath) error(400, 'path is required');
  requireAbsolute(dirPath, 'fs:watchFolder');
  const hooks = getWatchHooks();
  if (hooks) {
    hooks.startFolderWatch(dirPath);
  }
  return { ok: true };
});
