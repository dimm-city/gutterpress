import { json } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { filePath?: string };
    if (!body.filePath) return new Response('filePath is required', { status: 400 });
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    hooks.showItemInFolder(body.filePath);
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
