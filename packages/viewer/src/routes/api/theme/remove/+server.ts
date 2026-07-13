import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; id?: string };
    const projectDir = requireAbsolute(body.projectDir, 'theme/remove');
    if (typeof body.id !== 'string' || !body.id) {
      error(400, 'theme/remove requires an id');
    }
    return { projectDir, id: body.id };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.removeProjectTheme(body.projectDir, body.id);
    return { ok: true };
  },
});
