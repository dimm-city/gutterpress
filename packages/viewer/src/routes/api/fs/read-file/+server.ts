import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const filePath = body.path;
    if (!filePath) return error(400, 'path is required');
    if (!path.isAbsolute(filePath)) return error(400, `fs:readFile requires an absolute path, got: ${filePath}`);
    const content = await readFile(filePath, 'utf-8');
    return json(content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
