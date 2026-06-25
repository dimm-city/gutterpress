import { json, error } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const dirPath = body.path;
    if (!dirPath) return error(400, 'path is required');
    if (!path.isAbsolute(dirPath)) return error(400, `fs:listDir requires an absolute path, got: ${dirPath}`);
    const entries = await readdir(dirPath, { withFileTypes: true });
    return json(
      entries.map((entry) => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDir: entry.isDirectory(),
      }))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
