import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ imagePath: string }>({
  validate: (raw) => {
    const body = raw as { imagePath?: string };
    if (!body.imagePath || typeof body.imagePath !== 'string') {
      error(400, "'imagePath' string is required");
    }
    return { imagePath: requireAbsolute(body.imagePath, 'media:inspect') };
  },
  call: async ({ body }) => {
    let s;
    try {
      s = await stat(body.imagePath);
    } catch {
      return null;
    }
    const lib = await loadLib();
    const info = await lib.inspectImage(body.imagePath);
    return { fileSize: s.size, info };
  },
});
