import { error } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { defaultName?: string }) => {
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  const res = await hooks.showSaveDialog({
    title: 'Save PDF',
    defaultPath: body.defaultName ?? 'book.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
});
