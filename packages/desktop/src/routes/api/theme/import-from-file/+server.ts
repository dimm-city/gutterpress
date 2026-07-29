import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #106: import a theme from a `.zip` package or a bare `.css` file. Uses the
// native file picker (host side) then dispatches by extension in the lib. Host
// Node only (fflate unzip + postcss validation) — never in the client bundle.
export const POST: RequestHandler = defineRoute<{ projectDir: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'theme/import-from-file'),
  }),
  call: async ({ body, hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Choose a theme package (.zip) or stylesheet (.css)',
      properties: ['openFile'],
      filters: [{ name: 'Theme', extensions: ['zip', 'css'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const lib = await loadLib();
    return lib.importThemeFromFile(body.projectDir, res.filePaths[0]!);
  },
});
