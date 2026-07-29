import { error } from '@sveltejs/kit';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { scheduleAutoWriteEffects } from '../../../../../electron/server-bridge/write-hooks';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { requireSegment } from '../_shared/validate-segment';
import type { RequestHandler } from './$types';

// FileTree row/toolbar "New folder" (UX review M9). Same `dir` + `name`
// shape as create-file — see that route's header comment.
export const POST: RequestHandler = defineRoute<{ dir: string; name: string }>({
  validate: async (raw) => {
    const body = raw as { dir?: string; name?: string };
    const dir = await requireWithinProjectRoot(requireAbsolute(body.dir, 'fs:createFolder'), 'fs:createFolder');
    const name = requireSegment(body.name, 'fs:createFolder name');
    return { dir, name };
  },
  call: async ({ body }) => {
    const target = await requireWithinProjectRoot(path.join(body.dir, body.name), 'fs:createFolder');
    try {
      await mkdir(target, { recursive: false });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') {
        error(409, `"${body.name}" already exists here.`);
      }
      throw e;
    }

    scheduleAutoWriteEffects(target);

    return { path: target };
  },
});
