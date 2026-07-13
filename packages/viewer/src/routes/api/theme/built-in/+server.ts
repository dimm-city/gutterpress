import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute({
  call: async () => {
    const lib = await loadLib();
    return lib.listBuiltInThemes();
  },
});
