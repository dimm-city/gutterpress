import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ logPath?: string }>({
  call: async ({ body }) => {
    const logPath = body.logPath;
    if (!logPath || !path.isAbsolute(logPath)) return null;
    try {
      return await readFile(logPath, 'utf-8');
    } catch {
      return null;
    }
  },
});
