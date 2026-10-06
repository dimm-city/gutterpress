import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #265: copy a built-in look into `extensions/<id>/` (the one thing the rail
// COPIES — the look becomes the author's own editable files) and add it as
// `./extensions/<id>`. Idempotent: an existing folder is kept and only
// (re-)referenced. `id` is checked against the built-in list by the lib.
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/add-built-in');
    if (typeof body.id !== 'string' || !body.id.trim()) {
      error(400, 'extension/add-built-in requires an id');
    }
    return { projectDir, id: body.id.trim() };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.addBuiltInStyleSet(body.projectDir, body.id);
  },
});
