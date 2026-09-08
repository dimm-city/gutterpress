import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// Load-tests every configured extension through the one loader (a dynamic
// import() of whatever the manifest names — hence the project-dir guard).
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'extension/validate'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.validateProjectExtensions(body.projectDir);
  },
});
