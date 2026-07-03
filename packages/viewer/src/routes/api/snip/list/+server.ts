import { error } from '@sveltejs/kit';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  if (typeof body.projectDir !== 'string') {
    error(400, 'snip/list requires { projectDir: string }');
  }
  const lib = await import('@dimm-city/print-md');
  return lib.listSnippets(body.projectDir);
});
