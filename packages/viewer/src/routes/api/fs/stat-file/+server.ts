import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { path?: string }) => {
  const filePath = body.path;
  if (!filePath) error(400, 'path is required');
  requireAbsolute(filePath, 'fs:statFile');
  try {
    const s = await stat(filePath);
    return { mtimeMs: s.mtimeMs, size: s.size, exists: true };
  } catch {
    return { mtimeMs: 0, size: 0, exists: false };
  }
});
