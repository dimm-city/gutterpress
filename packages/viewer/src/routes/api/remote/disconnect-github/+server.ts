import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  Record<string, never>,
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  call: async ({ hooks }) =>
    handleRemoteErrors('remote:disconnectGitHub', async () => {
      await hooks.tokenStore.delete(hooks.GITHUB_HOST);
      return { ok: true };
    }),
});
