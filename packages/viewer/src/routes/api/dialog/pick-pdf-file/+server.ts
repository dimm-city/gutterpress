import { error } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/** Native open dialog for choosing a PDF (the publish artifact picker, #35). */
export const POST: RequestHandler = jsonRoute(async () => {
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  const res = await hooks.showOpenDialog({
    title: 'Choose the PDF to publish',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});
