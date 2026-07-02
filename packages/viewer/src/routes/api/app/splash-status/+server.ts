import { json, error } from '@sveltejs/kit';
import { getAppHooks } from '../../../../../electron/server-bridge/app-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      status?: string;
      progress?: number;
      sub?: string;
    };
    const hooks = getAppHooks();
    if (hooks) {
      hooks.updateSplash(body.status, body.progress, body.sub);
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
