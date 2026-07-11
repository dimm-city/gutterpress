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
    handleRemoteErrors('remote:listRepositories', async () => {
      const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
      if (!credential) {
        throw new Error('Connect GitHub first to see your repositories.');
      }
      const lib = await hooks.loadLib();
      if (!lib.listGitHubRepositories) {
        throw new Error('listGitHubRepositories not available in this version of the lib');
      }
      return lib.listGitHubRepositories(credential);
    }),
});
