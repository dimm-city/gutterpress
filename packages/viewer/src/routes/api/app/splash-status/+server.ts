import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ status?: string; progress?: number; sub?: string }>({
  call: async ({ body }) => {
    const hooks = getAppHooks();
    if (hooks) {
      hooks.updateSplash(body.status, body.progress, body.sub);
    }
    return { ok: true };
  },
});
