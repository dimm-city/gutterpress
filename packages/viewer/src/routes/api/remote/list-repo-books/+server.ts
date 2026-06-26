import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as {
      owner?: string;
      repo?: string;
      branch?: string;
    };
    return json(
      await handleRemoteErrors('remote:listRepoBooks', async () => {
        if (
          typeof body?.owner !== 'string' ||
          typeof body?.repo !== 'string' ||
          typeof body?.branch !== 'string' ||
          !body.owner ||
          !body.repo ||
          !body.branch
        ) {
          throw new Error('remote:listRepoBooks requires owner, repo and branch');
        }
        const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
        if (!credential) {
          throw new Error('Connect GitHub first to see your repositories.');
        }
        const lib = await hooks.loadLib();
        if (!lib.listRepoBooks) {
          throw new Error('listRepoBooks not available in this version of the lib');
        }
        return lib.listRepoBooks(credential, body.owner, body.repo, body.branch);
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
