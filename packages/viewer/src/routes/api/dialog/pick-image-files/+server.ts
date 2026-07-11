import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  call: async ({ hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Add images',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'tiff'],
        },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return [];
    return res.filePaths;
  },
});
