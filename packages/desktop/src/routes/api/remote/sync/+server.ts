import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { gitIdentityArgs } from '$lib/server/settings';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { projectDir: string; message?: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: async (raw) => {
    const body = raw as { projectDir?: string; message?: string };
    return { projectDir: await requireProjectDir(body?.projectDir, 'remote:sync'), message: body?.message };
  },
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:sync', async () => {
      const lib = await hooks.loadLib();
      if (!lib.syncProject) {
        throw new Error('syncProject not available in this version of the lib');
      }
      const identity = await gitIdentityArgs();
      return lib.syncProject({
        projectDir: body.projectDir,
        tokenStore: hooks.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
        ...(typeof body.message === 'string' && body.message.trim()
          ? { message: body.message.trim() }
          : {}),
      });
    }),
});
