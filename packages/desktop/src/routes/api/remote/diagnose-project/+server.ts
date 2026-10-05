import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string })?.projectDir, 'remote:diagnoseProject'),
  }),
  call: async ({ body }) =>
    handleRemoteErrors('remote:diagnoseProject', async () => {
      const lib = await loadLib();
      return lib.diagnoseProjectRemote(body.projectDir, { tokenStore: getHostServices().remote.tokenStore });
    }),
});
