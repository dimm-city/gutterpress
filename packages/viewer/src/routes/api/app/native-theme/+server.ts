import { error } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = jsonRoute(async () => {
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  return hooks.getNativeTheme();
});
