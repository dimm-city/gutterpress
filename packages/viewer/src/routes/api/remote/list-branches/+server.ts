import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as { owner?: string; repo?: string };
    return json(
      await handleRemoteErrors('remote:listBranches', async () => {
        if (
          typeof body?.owner !== 'string' ||
          typeof body?.repo !== 'string' ||
          !body.owner ||
          !body.repo
        ) {
          throw new Error('remote:listBranches requires owner and repo');
        }
        const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
        if (!credential) {
          throw new Error('Connect GitHub first to see your repositories.');
        }
        const lib = await hooks.loadLib();
        if (!lib.listGitHubBranches) {
          throw new Error('listGitHubBranches not available in this version of the lib');
        }
        return lib.listGitHubBranches(credential, body.owner, body.repo);
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
