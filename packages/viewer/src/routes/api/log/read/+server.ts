import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { logPath?: string }) => {
  const logPath = body.logPath;
  if (!logPath || !path.isAbsolute(logPath)) return null;
  try {
    return await readFile(logPath, 'utf-8');
  } catch {
    return null;
  }
});
