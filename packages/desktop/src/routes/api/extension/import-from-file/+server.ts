import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #106/#265: import a look from a `.zip` package or a bare `.css` file. Uses
// the native file picker (host side) then dispatches by extension in the
// lib, which lands it in `extensions/<id>/` and adds it to the manifest. Host
// Node only (fflate unzip + postcss validation) — never in the client bundle.
// Resolves null when cancelled.
export const POST: RequestHandler = defineRoute<{ projectDir: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'extension/import-from-file'),
  }),
  call: async ({ body, hooks }) => {
    const res = await hooks.showOpenDialog({
      title: 'Choose an extension package (.zip) or stylesheet (.css)',
      properties: ['openFile'],
      filters: [{ name: 'Extension', extensions: ['zip', 'css'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const lib = await loadLib();
    return lib.importExtensionFromFile(body.projectDir, res.filePaths[0]!);
  },
});
