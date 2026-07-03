import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(
  async (body: { status?: string; progress?: number; sub?: string }) => {
    const hooks = getAppHooks();
    if (hooks) {
      hooks.updateSplash(body.status, body.progress, body.sub);
    }
    return { ok: true };
  }
);
