import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The bundled markdown features an author can turn on with no install.
export const GET: RequestHandler = defineRoute({
  call: async () => {
    const lib = await loadLib();
    return lib.RECOMMENDED_EXTENSIONS;
  },
});
