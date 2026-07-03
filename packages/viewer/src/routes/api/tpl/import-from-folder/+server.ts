import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async () => {
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  const res = await hooks.showOpenDialog({
    title: 'Choose a template folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const templatesRoot = join(hooks.getUserDataPath(), 'templates');
  const lib = await import('@dimm-city/print-md');
  return lib.importTemplateFromFolder({
    sourceDir: res.filePaths[0]!,
    templatesRoot,
  });
});
