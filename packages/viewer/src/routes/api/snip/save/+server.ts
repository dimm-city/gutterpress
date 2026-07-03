import { error } from '@sveltejs/kit';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string; name?: string; body?: string }) => {
  if (typeof body.projectDir !== 'string' || typeof body.name !== 'string' || typeof body.body !== 'string') {
    error(400, 'snip/save requires { projectDir: string, name: string, body: string }');
  }
  const lib = await import('@dimm-city/print-md');
  return lib.saveSnippet(body.projectDir, body.name, body.body);
});
