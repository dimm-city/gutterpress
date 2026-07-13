import { stat } from 'node:fs/promises';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ path: string }>({
  validate: async (raw) => ({
    path: await requireWithinProjectRoot(
      requireAbsolute((raw as { path?: string }).path, 'fs:statFile'),
      'fs:statFile',
    ),
  }),
  call: async ({ body }) => {
    try {
      const s = await stat(body.path);
      return { mtimeMs: s.mtimeMs, size: s.size, exists: true };
    } catch {
      return { mtimeMs: 0, size: 0, exists: false };
    }
  },
});
