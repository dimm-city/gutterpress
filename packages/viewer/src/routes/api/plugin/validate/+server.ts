import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const { projectDir } = body;
  if (!projectDir || !isAbsolute(projectDir)) {
    error(400, 'plugin/validate requires an absolute projectDir');
  }
  const lib = await import('@dimm-city/print-md');
  return lib.validateProjectPlugins(projectDir);
});
