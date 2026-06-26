import { json, error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const filePath = body.path;
    if (!filePath) return error(400, 'path is required');
    if (!path.isAbsolute(filePath)) return error(400, `fs:statFile requires an absolute path, got: ${filePath}`);
    try {
      const s = await stat(filePath);
      return json({ mtimeMs: s.mtimeMs, size: s.size, exists: true });
    } catch {
      return json({ mtimeMs: 0, size: 0, exists: false });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
