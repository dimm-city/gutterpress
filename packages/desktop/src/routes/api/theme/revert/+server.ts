import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #106: re-apply the previously active theme. Throws (mapped to an error
// envelope) when there is no previous theme to revert to.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'theme/revert'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.revertTheme(body.projectDir);
  },
});
