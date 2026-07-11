import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'plugin/add-local'),
  }),
  call: async ({ body, hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Choose a plugin file or folder',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Plugin', extensions: ['js', 'mjs', 'cjs', 'ts'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const lib = await loadLib();
    return lib.addLocalPlugin(body.projectDir, res.filePaths[0]!);
  },
});
