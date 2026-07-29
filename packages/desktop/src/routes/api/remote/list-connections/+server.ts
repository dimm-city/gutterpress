import { getHooks, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  Record<string, never>,
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  // Redacted list only — host/username/label/kind, never tokens or ciphertext.
  call: async ({ hooks }) => hooks.tokenStore.listRedacted(),
});
