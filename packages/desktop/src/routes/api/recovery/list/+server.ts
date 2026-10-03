import { defineRoute, getHostServices, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'recovery:list'),
  }),
  call: async ({ body }) => getHostServices().recovery.list(body.projectDir),
});
