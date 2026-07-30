import { error } from '@sveltejs/kit';
import { defineRoute, loadApiLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; paths: string[] }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; paths?: string[] };
    const projectDir = await requireProjectDir(body.projectDir, 'style/set-active');
    if (!Array.isArray(body.paths)) {
      error(400, 'style/set-active requires a paths array');
    }
    return { projectDir, paths: body.paths };
  },
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.setActiveStyles(body.projectDir, body.paths);
  },
});
