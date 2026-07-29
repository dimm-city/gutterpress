import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { owner?: string; repo?: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:listBranches', async () => {
      if (
        typeof body?.owner !== 'string' ||
        typeof body?.repo !== 'string' ||
        !body.owner ||
        !body.repo
      ) {
        throw new Error('remote:listBranches requires owner and repo');
      }
      const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
      if (!credential) {
        throw new Error('Connect GitHub first to see your repositories.');
      }
      const lib = await hooks.loadLib();
      if (!lib.listGitHubBranches) {
        throw new Error('listGitHubBranches not available in this version of the lib');
      }
      return lib.listGitHubBranches(credential, body.owner, body.repo);
    }),
});
