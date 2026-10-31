import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// Book setup › Look's "Make an editable copy" (0.11.22's route, restored in
// #482): copy a built-in look into `extensions/<id>/` as the author's own
// files and list the copy as `./extensions/<id>`, in the built-in's place when
// the book lists it by name (`addBuiltInStyleSet`). Idempotent: a folder
// already there is kept and only (re-)referenced. `id` is checked against the
// built-in looks by the lib; it never names a path, so nothing outside the
// book's `extensions/` folder can be written.
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
