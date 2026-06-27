import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { templatesRoot?: string };
    let templatesRoot: string;
    if (typeof body.templatesRoot === 'string') {
      templatesRoot = body.templatesRoot;
    } else {
      const hooks = getDesktopHooks();
      if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
      templatesRoot = join(hooks.getUserDataPath(), 'templates');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.listCustomTemplates(templatesRoot));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
