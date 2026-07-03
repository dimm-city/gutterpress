import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { dirty?: boolean }) => {
  const hooks = getAppHooks();
  if (hooks) {
    hooks.setRendererDirty(!!body.dirty);
  }
  return { ok: true };
});
