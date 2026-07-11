import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { host?: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:disconnectHost', async () => {
      if (typeof body?.host !== 'string' || !body.host.trim()) {
        throw new Error('remote:disconnectHost requires a host');
      }
      await hooks.tokenStore.delete(body.host);
      return { ok: true };
    }),
});
