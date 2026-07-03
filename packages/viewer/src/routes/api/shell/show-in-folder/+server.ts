import { error } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { filePath?: string }) => {
  if (!body.filePath) error(400, 'filePath is required');
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  hooks.showItemInFolder(body.filePath);
  return { ok: true };
});
