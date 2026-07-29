import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, unknown>>({
  validate: (raw) => {
    const options = raw as Record<string, unknown>;
    requireAbsolute(options.dir, 'adoptFolder');
    return options;
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.adoptFolder(body as unknown as Parameters<typeof lib.adoptFolder>[0]);
  },
});
