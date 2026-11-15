import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The Publish wizard's folder picker, for a target's folder setting. The pick
// only names a folder to remember: it authorizes nothing. The publish run
// writes outside the book only to a folder main's own dialog returns at the
// time (electron/publish-run.ts).
export const POST: RequestHandler = defineRoute<{ defaultPath?: string }>({
  call: async ({ body }) => {
    const res = await getHostServices().desktop.showOpenDialog({
      title: 'Choose where to save',
      properties: ['openDirectory', 'createDirectory'],
      ...(body.defaultPath ? { defaultPath: body.defaultPath } : {}),
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  },
});
