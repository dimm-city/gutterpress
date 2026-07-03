import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  projectDir?: string;
  paths?: string[];
}) => {
  if (!body.projectDir || !isAbsolute(body.projectDir)) {
    error(400, 'style/set-active requires an absolute projectDir');
  }
  if (!Array.isArray(body.paths)) {
    error(400, 'style/set-active requires a paths array');
  }
  const lib = await import('@dimm-city/print-md/api');
  return lib.setActiveStyles(body.projectDir, body.paths);
});
