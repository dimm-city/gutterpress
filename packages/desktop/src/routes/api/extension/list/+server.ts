import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #265: the ONE extension rail. Every configured `extensions:` entry in
// manifest (= cascade) order, each described from its metadata — Book setup's
// Look and Extensions tabs show this single list.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'extension/list'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listProjectExtensions(body.projectDir);
  },
});
