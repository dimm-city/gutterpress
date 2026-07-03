import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { path?: string }) => {
  const filePath = body.path;
  if (!filePath) error(400, 'path is required');
  requireAbsolute(filePath, 'fs:readFile');
  return readFile(filePath, 'utf-8');
});
