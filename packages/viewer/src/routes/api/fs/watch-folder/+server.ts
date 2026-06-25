import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import type { RequestHandler } from './$types';

interface WatchHooks {
  startFolderWatch: (dir: string) => void;
  stopFolderWatch: () => void;
  getWatchedDir: () => string | null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const dirPath = body.path;
    if (!dirPath) return error(400, 'path is required');
    if (!path.isAbsolute(dirPath)) return error(400, `fs:watchFolder requires an absolute path, got: ${dirPath}`);
    const hooks = (globalThis as unknown as { __printMdWatchHooks__?: WatchHooks }).__printMdWatchHooks__;
    if (hooks) {
      hooks.startFolderWatch(dirPath);
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
