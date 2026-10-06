import { join } from 'node:path';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const res = await getHostServices().desktop.showOpenDialog({
      title: 'Choose a template folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const templatesRoot = join(getHostServices().desktop.getUserDataPath(), 'templates');
    const lib = await loadLib();
    return lib.importTemplateFromFolder({
      sourceDir: res.filePaths[0]!,
      templatesRoot,
    });
  },
});
