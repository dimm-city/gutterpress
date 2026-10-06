import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ host?: string }>({
  // Returns redacted status only — the token NEVER crosses this boundary.
  call: async ({ body }) => getHostServices().remote.tokenStore.status(body?.host || getHostServices().remote.GITHUB_HOST),
});
