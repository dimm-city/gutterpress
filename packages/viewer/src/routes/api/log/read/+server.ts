import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { logPath?: string };
    const logPath = body.logPath;
    if (!logPath || !path.isAbsolute(logPath)) return json(null);
    try {
      const content = await readFile(logPath, 'utf-8');
      return json(content);
    } catch {
      return json(null);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
