import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as { host?: string };
    // Pure lookup (no I/O): token-settings deep link for recognized forges.
    if (typeof body?.host !== 'string' || !body.host.trim()) return json(null);
    const lib = await hooks.loadLib();
    if (!lib.knownForgeTokenUrl) return json(null);
    return json(await lib.knownForgeTokenUrl(body.host));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
