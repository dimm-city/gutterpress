import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #265: add an extension the author already has on disk — a folder (a look,
// a component library, a plugin package) or a bare plugin file — via the
// native picker. The chosen path is REFERENCED IN PLACE (written to the
// manifest relative to the project), never copied; the host's own dialog is
// what authorizes an absolute path here (compare `extension/add`, which
// refuses one from the renderer). Resolves null when cancelled.
export const POST: RequestHandler = defineRoute<{ projectDir: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'extension/add-local'),
  }),
  call: async ({ body, hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Choose an extension folder or plugin file',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Extension', extensions: ['js', 'mjs', 'cjs', 'ts'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const lib = await loadLib();
    return lib.addExtension(body.projectDir, res.filePaths[0]!);
  },
});
