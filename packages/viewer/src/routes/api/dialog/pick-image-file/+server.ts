import { json } from '@sveltejs/kit';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  try {
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    const res = await hooks.showOpenDialog({
      title: 'Insert image',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'tiff'],
        },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return json(null);
    return json(res.filePaths[0]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
