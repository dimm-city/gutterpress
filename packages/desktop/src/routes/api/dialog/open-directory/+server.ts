import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const res = await getHostServices().desktop.showOpenDialog({
      title: 'Open Gutterpress book',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    // This dialog serves two callers: "open a project" and the Publish
    // panel's artifact-directory picker (HTML providers upload a directory).
    // Registering the chosen path is what lets `publish:run` accept an
    // out-of-project artifact DIRECTORY the author actually picked, on the
    // same footing as the PDF picker. Registering a directory authorizes
    // nothing else meaningful: the other consumers of this capability
    // (`fs:copyFile`/`media:importImage` `src`) match exact paths and would
    // fail on a directory anyway.
    getHostServices().pickedFiles.register(res.filePaths);
    return res.filePaths[0];
  },
});
