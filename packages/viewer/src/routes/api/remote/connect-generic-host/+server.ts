import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  host?: string;
  username?: string;
  token?: string;
  repoUrl?: string;
}) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:connectGenericHost', async () => {
    if (
      !body ||
      typeof body.host !== 'string' ||
      typeof body.token !== 'string' ||
      !body.host.trim() ||
      !body.token.trim()
    ) {
      throw new Error('remote:connectGenericHost requires { host, token }');
    }
    const lib = await hooks.loadLib();
    if (!lib.connectGenericHost) {
      throw new Error('connectGenericHost not available in this version of the lib');
    }
    // Validates with a refs probe BEFORE returning — a bad paste never
    // reaches the credential store.
    const credential = await lib.connectGenericHost({
      host: body.host,
      ...(body.username ? { username: body.username } : {}),
      token: body.token,
      ...(body.repoUrl ? { repoUrl: body.repoUrl } : {}),
    });
    await hooks.tokenStore.set(credential.host, credential);
    // Response must NOT include the token — only redacted status.
    return {
      connected: true,
      host: credential.host,
      ...(credential.username ? { username: credential.username } : {}),
    };
  });
});
