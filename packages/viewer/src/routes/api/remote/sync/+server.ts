import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as {
      projectDir?: string;
      message?: string;
    };
    return json(
      await handleRemoteErrors('remote:sync', async () => {
        if (!body?.projectDir || !isAbsolute(body.projectDir)) {
          throw new Error('remote:sync requires an absolute project path');
        }
        const lib = await hooks.loadLib();
        if (!lib.syncProject) {
          throw new Error('syncProject not available in this version of the lib');
        }
        return lib.syncProject({
          projectDir: body.projectDir,
          tokenStore: hooks.tokenStore,
          ...(typeof body.message === 'string' && body.message.trim()
            ? { message: body.message.trim() }
            : {}),
        });
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
