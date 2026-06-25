import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir, id } = await request.json().catch(() => ({})) as {
      projectDir?: string;
      id?: string;
    };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'theme/remove requires an absolute projectDir');
    }
    if (typeof id !== 'string' || !id) {
      return error(400, 'theme/remove requires an id');
    }
    const lib = await import('@dimm-city/print-md');
    await lib.removeProjectTheme(projectDir, id);
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
