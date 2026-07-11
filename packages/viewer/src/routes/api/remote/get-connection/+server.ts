import { getHooks, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { host?: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  // Returns redacted status only — the token NEVER crosses this boundary.
  call: async ({ body, hooks }) => hooks.tokenStore.status(body?.host || hooks.GITHUB_HOST),
});
