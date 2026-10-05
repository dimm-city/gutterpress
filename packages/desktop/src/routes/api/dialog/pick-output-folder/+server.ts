import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The Publish wizard's output-folder picker. Unlike `open-directory`, whose
// pick only ever authorizes a READ (a project to open, an artifact to
// upload), this dialog grants a WRITE capability: the author explicitly chose
// the folder as a save destination, on the same footing as the native Save
// dialog in `save-pdf`. So the chosen directory is registered in BOTH pools
// (see `../../../../../electron/server-bridge/picked-files.ts`):
//
//   - save paths — lets `api:build` accept it as `out` even when it is
//     outside the open book (an in-book `out` needs no grant at all);
//   - picked files — lets `publish:run` later read the built artifact there,
//     mirroring `open-directory`. Registering a directory authorizes nothing
//     else meaningful: the other consumers of this capability
//     (`fs:copyFile`/`media:importImage` `src`) match exact paths and would
//     fail on a directory anyway.
export const POST: RequestHandler = defineRoute<{ defaultPath?: string }>({
  call: async ({ body }) => {
    const res = await getHostServices().desktop.showOpenDialog({
      title: 'Choose where to save',
      properties: ['openDirectory', 'createDirectory'],
      ...(body.defaultPath ? { defaultPath: body.defaultPath } : {}),
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const dir = res.filePaths[0];
    getHostServices().savePaths.register(dir);
    getHostServices().pickedFiles.register([dir]);
    return dir;
  },
});
