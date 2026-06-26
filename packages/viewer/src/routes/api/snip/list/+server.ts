import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    if (typeof body.projectDir !== 'string') {
      return error(400, 'snip/list requires { projectDir: string }');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.listSnippets(body.projectDir));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
