import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; name: string; body: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; name?: string; body?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'snip/save');
    if (typeof body.name !== 'string' || typeof body.body !== 'string') {
      error(400, 'snip/save requires { projectDir: string, name: string, body: string }');
    }
    return { projectDir, name: body.name, body: body.body };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.saveSnippet(body.projectDir, body.name, body.body);
  },
});
