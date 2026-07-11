import { readFile } from 'node:fs/promises';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ path: string }>({
  validate: (raw) => ({
    // includeReadOnlyRoots: the only generic-fs caller reading OUTSIDE the
    // open project is +page.svelte's crash-recovery restore, reading a
    // sidecar snapshot's absolute recoveryPath (ARCH review #37).
    path: requireWithinProjectRoot(
      requireAbsolute((raw as { path?: string }).path, 'fs:readFile'),
      'fs:readFile',
      { includeReadOnlyRoots: true },
    ),
  }),
  call: async ({ body }) => readFile(body.path, 'utf-8'),
});
