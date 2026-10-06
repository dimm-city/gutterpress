import { defineRoute, getHostServices, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ filePath: string }>({
  validate: (raw) => ({
    filePath: requireAbsolute((raw as { filePath?: string }).filePath, 'recovery:clear'),
  }),
  call: async ({ body }) => getHostServices().recovery.clear(body.filePath),
});
