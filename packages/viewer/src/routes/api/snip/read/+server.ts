import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string; fileName?: string };
    if (typeof body.projectDir !== 'string' || typeof body.fileName !== 'string') {
      return error(400, 'snip/read requires { projectDir: string, fileName: string }');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.readSnippet(body.projectDir, body.fileName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
