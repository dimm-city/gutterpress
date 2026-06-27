import { json } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    return json(hooks.getNativeTheme());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
