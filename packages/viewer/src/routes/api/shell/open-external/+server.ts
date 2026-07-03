import { error } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { url?: string }) => {
  if (!body.url) error(400, 'url is required');
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  await hooks.openExternal(body.url);
  return { ok: true };
});
