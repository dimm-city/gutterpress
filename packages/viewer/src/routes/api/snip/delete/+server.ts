import { error } from '@sveltejs/kit';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string; fileName?: string }) => {
  if (typeof body.projectDir !== 'string' || typeof body.fileName !== 'string') {
    error(400, 'snip/delete requires { projectDir: string, fileName: string }');
  }
  const lib = await import('@dimm-city/print-md');
  await lib.deleteSnippet(body.projectDir, body.fileName);
  return { ok: true };
});
