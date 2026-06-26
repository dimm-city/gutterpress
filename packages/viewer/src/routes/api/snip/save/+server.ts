import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string; name?: string; body?: string };
    if (typeof body.projectDir !== 'string' || typeof body.name !== 'string' || typeof body.body !== 'string') {
      return error(400, 'snip/save requires { projectDir: string, name: string, body: string }');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.saveSnippet(body.projectDir, body.name, body.body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
