import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';

export const POST: RequestHandler = async () => {
  try {
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    const res = await hooks.showOpenDialog({
      title: 'Choose a template folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return json(null);
    const templatesRoot = join(hooks.getUserDataPath(), 'templates');
    const lib = await import('@dimm-city/print-md');
    const result = await lib.importTemplateFromFolder({
      sourceDir: res.filePaths[0]!,
      templatesRoot,
    });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
