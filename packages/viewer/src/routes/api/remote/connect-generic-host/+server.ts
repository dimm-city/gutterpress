import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as {
      host?: string;
      username?: string;
      token?: string;
      repoUrl?: string;
    };
    return json(
      await handleRemoteErrors('remote:connectGenericHost', async () => {
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
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
