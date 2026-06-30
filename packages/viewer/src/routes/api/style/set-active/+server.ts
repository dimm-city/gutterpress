import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      projectDir?: string;
      paths?: string[];
    };
    if (!body.projectDir || !isAbsolute(body.projectDir)) {
      return error(400, 'style/set-active requires an absolute projectDir');
    }
    if (!Array.isArray(body.paths)) {
      return error(400, 'style/set-active requires a paths array');
    }
    const lib = await import('@dimm-city/print-md/api');
    return json(await lib.setActiveStyles(body.projectDir, body.paths));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
