import { error } from '@sveltejs/kit';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ cssPath?: string; content: string }>({
  validate: (raw) => {
    const body = raw as { cssPath?: string; content?: string };
    if (typeof body.content !== 'string') error(400, "'content' string is required");
    return { cssPath: body.cssPath, content: body.content };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.checkCss(body.content, body.cssPath);
  },
});
