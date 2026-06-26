import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks } from '../_hooks';

export const POST: RequestHandler = async () => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    // Redacted list only — host/username/label/kind, never tokens or ciphertext.
    return json(await hooks.tokenStore.listRedacted());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
