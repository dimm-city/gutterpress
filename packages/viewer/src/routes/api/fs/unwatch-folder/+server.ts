import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import { getWatchHooks } from '../../../../../electron/server-bridge/watch-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const dirPath = body.path;
    const hooks = getWatchHooks();
    if (hooks) {
      const watchedDir = hooks.getWatchedDir();
      if (dirPath && path.isAbsolute(dirPath)) {
        const normalized = path.resolve(dirPath);
        if (watchedDir === normalized) hooks.stopFolderWatch();
      }
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
