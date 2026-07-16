import { error } from '@sveltejs/kit';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scheduleAutoWriteEffects } from '../../../../../electron/server-bridge/write-hooks';
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
    scheduleAutoWriteEffects(body.path);

    const s = await stat(body.path);
    return { mtimeMs: s.mtimeMs };
  },
});
