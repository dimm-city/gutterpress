import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  // Redacted list only — host/username/label/kind, never tokens or ciphertext.
  call: async () => getHostServices().remote.tokenStore.listRedacted(),
});
