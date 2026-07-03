import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(
  async (body: { projectDir?: string; id?: string }) => {
    const { projectDir, id } = body;
    if (!projectDir || !isAbsolute(projectDir)) {
      error(400, 'theme/remove requires an absolute projectDir');
    }
    if (typeof id !== 'string' || !id) {
      error(400, 'theme/remove requires an id');
    }
    const lib = await import('@dimm-city/print-md');
    await lib.removeProjectTheme(projectDir, id);
    return { ok: true };
  }
);
