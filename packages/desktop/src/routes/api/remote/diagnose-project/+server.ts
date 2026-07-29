import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { projectDir: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string })?.projectDir, 'remote:diagnoseProject'),
  }),
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:diagnoseProject', async () => {
      const lib = await hooks.loadLib();
      if (!lib.diagnoseProjectRemote) {
        throw new Error('diagnoseProjectRemote not available in this version of the lib');
      }
      return lib.diagnoseProjectRemote(body.projectDir, { tokenStore: hooks.tokenStore });
    }),
});
