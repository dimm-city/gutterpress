import { error } from '@sveltejs/kit';
import { getHooks } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { host?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  // Pure lookup (no I/O): token-settings deep link for recognized forges.
  if (typeof body?.host !== 'string' || !body.host.trim()) return null;
  const lib = await hooks.loadLib();
  if (!lib.knownForgeTokenUrl) return null;
  return lib.knownForgeTokenUrl(body.host);
});
