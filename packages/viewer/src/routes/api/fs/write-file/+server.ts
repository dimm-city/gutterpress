import { error } from '@sveltejs/kit';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getWriteHooks } from '../../../../../electron/server-bridge/write-hooks';
import { isWithinRoot } from '../../../../../electron/server-bridge/fs-guard';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ path: string; content: string }>({
  validate: async (raw) => {
    const body = raw as { path?: string; content?: string };
    if (body.content === undefined) error(400, 'content is required');
    return {
      path: await requireWithinProjectRoot(requireAbsolute(body.path, 'fs:writeFile'), 'fs:writeFile'),
      content: body.content,
    };
  },
  call: async ({ body }) => {
    await mkdir(path.dirname(body.path), { recursive: true });
    await writeFile(body.path, body.content, 'utf-8');

    // Trigger auto-snapshot/sync debounce for edits inside the open project.
    // The hooks are registered by main.ts on startup via globalThis. This is
    // a NARROWER check than the `requireWithinProjectRoot` authorization
    // above (which also allows the active-preview dir before watching
    // starts) — snapshot/sync should only fire once the folder watcher is
    // actually tracking the write's target dir.
    const hooks = getWriteHooks();
    if (hooks) {
      const watchedDir = hooks.getWatchedDir();
      if (watchedDir && isWithinRoot(body.path, watchedDir)) {
        hooks.scheduleAutoSnapshot(watchedDir);
        hooks.scheduleAutoSync(watchedDir);
      }
    }

    const s = await stat(body.path);
    return { mtimeMs: s.mtimeMs };
  },
});
