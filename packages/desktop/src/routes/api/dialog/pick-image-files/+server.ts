import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const res = await getHostServices().desktop.showOpenDialog({
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
    // Register every path the NATIVE dialog itself just returned — see the
    // matching comment on `dialog/pick-image-file`'s route.
    getHostServices().pickedFiles.register(res.filePaths);
    return res.filePaths;
  },
});
