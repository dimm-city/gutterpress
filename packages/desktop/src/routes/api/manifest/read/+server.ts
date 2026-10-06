import { defineRoute, loadApiLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'manifest/read'),
  }),
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.readManifestFields(body.projectDir);
  },
});
