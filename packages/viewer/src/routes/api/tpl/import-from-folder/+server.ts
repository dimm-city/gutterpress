import { join } from 'node:path';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  call: async ({ hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Choose a template folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const templatesRoot = join(hooks.getUserDataPath(), 'templates');
    const lib = await loadLib();
    return lib.importTemplateFromFolder({
      sourceDir: res.filePaths[0]!,
      templatesRoot,
    });
  },
});
