import { error } from '@sveltejs/kit';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getWriteHooks } from '../../../../../electron/server-bridge/write-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { path?: string; content?: string }) => {
  const filePath = body.path;
  const content = body.content;
  if (!filePath) error(400, 'path is required');
  if (content === undefined) error(400, 'content is required');
  requireAbsolute(filePath, 'fs:writeFile');

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');

  // Trigger auto-snapshot/sync debounce for edits inside the open project.
  // The hooks are registered by main.ts on startup via globalThis.
  const hooks = getWriteHooks();
  if (hooks) {
    const watchedDir = hooks.getWatchedDir();
    if (watchedDir) {
      const resolved = path.resolve(filePath);
      const root = path.resolve(watchedDir);
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        hooks.scheduleAutoSnapshot(watchedDir);
        hooks.scheduleAutoSync(watchedDir);
      }
    }
  }

  const s = await stat(filePath);
  return { mtimeMs: s.mtimeMs };
});
