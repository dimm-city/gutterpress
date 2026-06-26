import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    return json(
      await handleRemoteErrors('remote:diagnoseProject', async () => {
        if (!body?.projectDir || !isAbsolute(body.projectDir)) {
          throw new Error('remote:diagnoseProject requires an absolute project path');
        }
        const lib = await hooks.loadLib();
        if (!lib.diagnoseProjectRemote) {
          throw new Error('diagnoseProjectRemote not available in this version of the lib');
        }
        return lib.diagnoseProjectRemote(body.projectDir, { tokenStore: hooks.tokenStore });
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
