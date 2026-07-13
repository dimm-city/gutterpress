import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; packageName: string }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; packageName?: string };
    const projectDir = requireAbsolute(body.projectDir, 'plugin/add-npm');
    if (typeof body.packageName !== 'string' || !body.packageName) {
      error(400, 'plugin/add-npm requires a packageName');
    }
    return { projectDir, packageName: body.packageName };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.addNpmPlugin(body.projectDir, body.packageName);
  },
});
