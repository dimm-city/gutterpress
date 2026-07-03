import { error } from '@sveltejs/kit';
import { getHooks } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async () => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  // Redacted list only — host/username/label/kind, never tokens or ciphertext.
  return hooks.tokenStore.listRedacted();
});
