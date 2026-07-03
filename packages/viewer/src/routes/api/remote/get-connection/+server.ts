import { error } from '@sveltejs/kit';
import { getHooks } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { host?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  // Returns redacted status only — the token NEVER crosses this boundary.
  return hooks.tokenStore.status(body?.host || hooks.GITHUB_HOST);
});
