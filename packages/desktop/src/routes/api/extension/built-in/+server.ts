import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The built-in looks (embedded assets) — static metadata, no project needed.
export const GET: RequestHandler = defineRoute({
  call: async () => {
    const lib = await loadLib();
    return lib.listBuiltInStyleSets();
  },
});
