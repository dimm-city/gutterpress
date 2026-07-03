import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async () => {
  const hooks = getAppHooks();
  if (hooks) {
    hooks.updateSplash('Ready', 100);
    hooks.showMainWindowAndCloseSplash();
  }
  return { ok: true };
});
