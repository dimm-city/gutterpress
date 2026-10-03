import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const res = await getHostServices().desktop.showOpenDialog({
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
    getHostServices().pickedFiles.register(res.filePaths);
    return res.filePaths[0];
  },
});
