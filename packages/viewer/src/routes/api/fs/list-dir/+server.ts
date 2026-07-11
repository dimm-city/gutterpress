import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ path: string }>({
  validate: (raw) => ({
    path: requireWithinProjectRoot(
      requireAbsolute((raw as { path?: string }).path, 'fs:listDir'),
      'fs:listDir',
    ),
  }),
  call: async ({ body }) => {
    const entries = await readdir(body.path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(body.path, entry.name),
      isDir: entry.isDirectory(),
    }));
  },
});
