import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute({
  call: async () => {
    const hooks = getAppHooks();
    if (hooks) {
      hooks.updateSplash('Ready', 100);
      hooks.showMainWindowAndCloseSplash();
    }
    return { ok: true };
  },
});
