import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #106: the theme active immediately before the current one (the "Revert to
// previous theme" target), or null when there is none. Persisted indefinitely
// in the manifest — no timer.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'theme/previous'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.getPreviousTheme(body.projectDir);
  },
});
