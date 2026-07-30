import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #106: re-apply the previously active theme. Throws (mapped to an error
// envelope) when there is no previous theme to revert to.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'theme/revert'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.revertTheme(body.projectDir);
  },
});
