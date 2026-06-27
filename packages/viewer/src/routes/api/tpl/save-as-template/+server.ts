import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.projectDir !== 'string') {
      return new Response('saveAsTemplate requires { projectDir: string }', { status: 400 });
    }
    const projectDir: string = body.projectDir;
    const name: string = typeof body.name === 'string' ? body.name : '';
    const hooks = getDesktopHooks();
    if (!hooks) return new Response('Desktop hooks not registered', { status: 503 });
    const templatesRoot = join(hooks.getUserDataPath(), 'templates');
    const lib = await import('@dimm-city/print-md');
    const result = await lib.saveProjectAsTemplate({ projectDir, name, templatesRoot });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 500 });
  }
};
