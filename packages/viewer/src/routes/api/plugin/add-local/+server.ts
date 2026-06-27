import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir } = await request.json().catch(() => ({})) as { projectDir?: string };
    if (!projectDir || !isAbsolute(projectDir)) {
      return new Response('plugin/add-local requires an absolute projectDir', { status: 400 });
    }
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    const res = await hooks.showOpenDialog({
      title: 'Choose a plugin file or folder',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Plugin', extensions: ['js', 'mjs', 'cjs', 'ts'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return json(null);
    const lib = await import('@dimm-city/print-md');
    return json(await lib.addLocalPlugin(projectDir, res.filePaths[0]!));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
