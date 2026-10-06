import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { gitIdentityArgs } from '$lib/server/settings';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; message?: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; message?: string };
    return { projectDir: await requireProjectDir(body?.projectDir, 'remote:sync'), message: body?.message };
  },
  call: async ({ body }) =>
    handleRemoteErrors('remote:sync', async () => {
      const lib = await loadLib();
      const identity = await gitIdentityArgs();
      return lib.syncProject({
        projectDir: body.projectDir,
        tokenStore: getHostServices().remote.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
        ...(typeof body.message === 'string' && body.message.trim()
          ? { message: body.message.trim() }
          : {}),
      });
    }),
});
