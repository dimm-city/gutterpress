import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ dirty?: boolean }>({
  call: async ({ body }) => {
    const hooks = getAppHooks();
    if (hooks) {
      hooks.setRendererDirty(!!body.dirty);
    }
    return { ok: true };
  },
});
