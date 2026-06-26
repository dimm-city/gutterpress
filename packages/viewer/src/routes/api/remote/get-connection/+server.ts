import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as { host?: string };
    // Returns redacted status only — the token NEVER crosses this boundary.
    return json(await hooks.tokenStore.status(body?.host || hooks.GITHUB_HOST));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
