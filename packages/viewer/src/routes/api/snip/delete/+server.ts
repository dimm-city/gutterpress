import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string; fileName?: string };
    if (typeof body.projectDir !== 'string' || typeof body.fileName !== 'string') {
      return error(400, 'snip/delete requires { projectDir: string, fileName: string }');
    }
    const lib = await import('@dimm-city/print-md');
    await lib.deleteSnippet(body.projectDir, body.fileName);
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
