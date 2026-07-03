import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { gitIdentityArgs } from '$lib/server/settings';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  projectDir?: string;
  message?: string;
}) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:sync', async () => {
    if (!body?.projectDir || !isAbsolute(body.projectDir)) {
      throw new Error('remote:sync requires an absolute project path');
    }
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
  });
});
