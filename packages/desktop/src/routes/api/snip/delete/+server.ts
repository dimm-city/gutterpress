import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; fileName: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; fileName?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'snip/delete');
    if (typeof body.fileName !== 'string') {
      error(400, 'snip/delete requires { projectDir: string, fileName: string }');
    }
    return { projectDir, fileName: body.fileName };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.deleteSnippet(body.projectDir, body.fileName);
    return { ok: true };
  },
});
