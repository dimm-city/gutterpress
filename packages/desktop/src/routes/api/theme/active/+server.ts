import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'theme/active'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.getActiveTheme(body.projectDir);
  },
});
