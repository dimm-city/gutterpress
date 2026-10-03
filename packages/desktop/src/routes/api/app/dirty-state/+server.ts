import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ dirty?: boolean }>({
  call: async ({ body }) => {
    getHostServices().app.setRendererDirty(!!body.dirty);
    return { ok: true };
  },
});
