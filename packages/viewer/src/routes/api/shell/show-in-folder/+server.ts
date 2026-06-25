import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { filePath?: string };
    if (!body.filePath) return error(400, 'filePath is required');
    const { shell } = await import('electron');
    shell.showItemInFolder(body.filePath);
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
