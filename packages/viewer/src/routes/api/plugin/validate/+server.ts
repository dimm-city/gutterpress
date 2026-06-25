import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir } = await request.json().catch(() => ({})) as { projectDir?: string };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'plugin/validate requires an absolute projectDir');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.validateProjectPlugins(projectDir));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
