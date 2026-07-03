import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  projectDir?: string;
  ref?: string;
  enabled?: boolean;
}) => {
  const { projectDir, ref, enabled } = body;
  if (!projectDir || !isAbsolute(projectDir)) {
    error(400, 'plugin/set-enabled requires an absolute projectDir');
  }
  if (typeof ref !== 'string') {
    error(400, 'plugin/set-enabled requires a ref string');
  }
  const lib = await import('@dimm-city/print-md');
  await lib.setPluginEnabled(projectDir, ref, Boolean(enabled));
  return { ok: true };
});
