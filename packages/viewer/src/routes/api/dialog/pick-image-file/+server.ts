import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import { getPickedFilesHooks } from '../../../../../electron/server-bridge/picked-files';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  call: async ({ hooks }) => {
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
    if (res.canceled || res.filePaths.length === 0) return null;
    // Register the path the NATIVE dialog itself just returned as a one-time
    // capability (P1 review): `media:importImage`/`fs:copyFile` require this
    // before copying a `src` from outside the project, so a script POSTing an
    // arbitrary path directly — skipping this route — can't authorize itself.
    getPickedFilesHooks()?.register(res.filePaths);
    return res.filePaths[0];
  },
});
