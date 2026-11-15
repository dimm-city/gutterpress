import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The absolute path the native SAVE dialog returns is registered as a
// one-time "save path" capability (`../../../../../electron/server-bridge/picked-files.ts`),
// consumed by the export controller before it will write to `out` — see that
// module's doc comment for the full policy. Without it any same-origin script
// could POST an arbitrary absolute `out` straight to `api:build` and have the
// export controller atomically rename the finished PDF onto it, overwriting
// any file the user can write.
export const POST: RequestHandler = defineRoute<{ defaultName?: string }>({
  call: async ({ body }) => {
    const res = await getHostServices().desktop.showSaveDialog({
      title: 'Save PDF',
      defaultPath: body.defaultName ?? 'book.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    getHostServices().savePaths.register(res.filePath);
    return res.filePath;
  },
});
