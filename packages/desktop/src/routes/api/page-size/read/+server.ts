import { defineRoute, loadApiLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** A book's page size as recorded: manifest preset + bounds, and the stylesheet's `@page` size. */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'page-size/read'),
  }),
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.readPageSetup(body.projectDir);
  },
});
