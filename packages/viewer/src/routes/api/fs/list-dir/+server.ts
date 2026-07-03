import { error } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { path?: string }) => {
  const dirPath = body.path;
  if (!dirPath) error(400, 'path is required');
  requireAbsolute(dirPath, 'fs:listDir');
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    path: path.join(dirPath, entry.name),
    isDir: entry.isDirectory(),
  }));
});
