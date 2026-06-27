import { json } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { url?: string };
    if (!body.url) return new Response('url is required', { status: 400 });
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    await hooks.openExternal(body.url);
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
