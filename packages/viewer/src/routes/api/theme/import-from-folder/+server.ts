import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const { projectDir } = body;
  if (!projectDir || !isAbsolute(projectDir)) {
    error(400, 'theme/import-from-folder requires an absolute projectDir');
  }
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  const res = await hooks.showOpenDialog({
    title: 'Choose a theme folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const lib = await import('@dimm-city/print-md');
  return lib.importThemeFromFolder(projectDir, res.filePaths[0]!);
});
