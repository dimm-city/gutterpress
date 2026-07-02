import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import { getWatchHooks } from '../../../../../electron/server-bridge/watch-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const dirPath = body.path;
    if (!dirPath) return error(400, 'path is required');
    if (!path.isAbsolute(dirPath)) return error(400, `fs:watchFolder requires an absolute path, got: ${dirPath}`);
    const hooks = getWatchHooks();
    if (hooks) {
      hooks.startFolderWatch(dirPath);
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
