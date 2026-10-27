import { defineRoute, loadApiLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** A book's page geometry as recorded: manifest preset + bounds, and the margins it prints with. */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'page-size/read'),
  }),
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.readPageSetup(body.projectDir);
  },
});
