import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import { getPickedFilesHooks } from '../../../../../electron/server-bridge/picked-files';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  call: async ({ hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Open Gutterpress project',
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
    getPickedFilesHooks()?.register(res.filePaths);
    return res.filePaths[0];
  },
});
