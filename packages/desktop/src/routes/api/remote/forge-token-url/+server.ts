import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ host?: string }>({
  // Pure lookup (no I/O): token-settings deep link for recognized forges.
  call: async ({ body }) => {
    if (typeof body?.host !== 'string' || !body.host.trim()) return null;
    const lib = await loadLib();
    if (!lib.knownForgeTokenUrl) return null;
    return lib.knownForgeTokenUrl(body.host);
  },
});
