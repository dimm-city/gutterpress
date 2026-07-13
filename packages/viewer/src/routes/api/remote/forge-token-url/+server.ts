import { getHooks, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { host?: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  // Pure lookup (no I/O): token-settings deep link for recognized forges.
  call: async ({ body, hooks }) => {
    if (typeof body?.host !== 'string' || !body.host.trim()) return null;
    const lib = await hooks.loadLib();
    if (!lib.knownForgeTokenUrl) return null;
    return lib.knownForgeTokenUrl(body.host);
  },
});
