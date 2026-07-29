import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'plugin/validate'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.validateProjectPlugins(body.projectDir);
  },
});
