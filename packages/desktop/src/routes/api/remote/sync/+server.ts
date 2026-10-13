import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { gitIdentityArgs } from '$lib/server/settings';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Manual sync of the open book with its online copy. `push: false` is "Get
 * latest": fetch and merge the online changes, never send anything back.
 * Neither form depends on automatic online backup being on.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; message?: string; push: boolean }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; message?: string; push?: unknown };
    return {
      projectDir: await requireProjectDir(body?.projectDir, 'remote:sync'),
      message: body?.message,
      push: body?.push !== false,
    };
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
        push: body.push,
        ...(typeof body.message === 'string' && body.message.trim()
          ? { message: body.message.trim() }
          : {}),
      });
    }),
});
