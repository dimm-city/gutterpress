import path from 'node:path';
import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// P1/finding #4 (2026-07-13 maintainer review): the returned `filePath` used
// to be handed back to the renderer with nothing enforcing that a later
// `api:build`'s `out` actually came from THIS dialog — any same-origin
// script could POST an arbitrary absolute `out` straight to `api:build` and
// have the export controller atomically rename the finished PDF onto it,
// overwriting any file the user can write. The absolute path the native SAVE
// dialog itself just returned is now registered as a one-time "save path"
// capability (`../../../../../electron/server-bridge/picked-files.ts`),
// consumed by the export controller before it will write to `out` — see that
// module's doc comment for the full policy.
//
// `defaultDir` only seeds where the dialog opens (the Publish wizard passes
// the book's remembered output folder); the capability is still the path the
// dialog returns, wherever the author finally points it.
export const POST: RequestHandler = defineRoute<{ defaultName?: string; defaultDir?: string }>({
  call: async ({ body }) => {
    const res = await getHostServices().desktop.showSaveDialog({
      title: 'Save PDF',
      defaultPath: body.defaultDir
        ? path.join(body.defaultDir, body.defaultName ?? 'book.pdf')
        : (body.defaultName ?? 'book.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    getHostServices().savePaths.register(res.filePath);
    return res.filePath;
  },
});
