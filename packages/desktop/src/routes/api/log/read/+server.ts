import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute } from '../../_lib/route';
import { requireWithinProjectRoot } from '../../_lib/fs-guard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ logPath?: string }>({
  call: async ({ body }) => {
    const logPath = body.logPath;
    if (!logPath || !path.isAbsolute(logPath)) return null;
    // Confine to the read-allow-list (ARCH #37): the operation log lives under
    // userData/logs/, covered by readOnlyRoots(). Without this a renderer-origin
    // fetch could read any absolute path's full contents — the exact
    // arbitrary-file-read primitive the fs-guard exists to close.
    await requireWithinProjectRoot(logPath, 'log:read', { includeReadOnlyRoots: true });
    try {
      return await readFile(logPath, 'utf-8');
    } catch {
      return null;
    }
  },
});
