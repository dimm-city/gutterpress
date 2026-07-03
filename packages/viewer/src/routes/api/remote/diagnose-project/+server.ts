import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:diagnoseProject', async () => {
    if (!body?.projectDir || !isAbsolute(body.projectDir)) {
      throw new Error('remote:diagnoseProject requires an absolute project path');
    }
    const lib = await hooks.loadLib();
    if (!lib.diagnoseProjectRemote) {
      throw new Error('diagnoseProjectRemote not available in this version of the lib');
    }
    return lib.diagnoseProjectRemote(body.projectDir, { tokenStore: hooks.tokenStore });
  });
});
