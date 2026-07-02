import { json, error } from '@sveltejs/kit';
import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  try {
    const hooks = getAppHooks();
    if (hooks) {
      hooks.resolveFlush();
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
