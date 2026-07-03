import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: Record<string, unknown>) => {
  if (typeof body.projectDir !== 'string') {
    error(400, 'saveAsTemplate requires { projectDir: string }');
  }
  const projectDir: string = body.projectDir;
  const name: string = typeof body.name === 'string' ? body.name : '';
  const hooks = getDesktopHooks();
  if (!hooks) error(503, 'Desktop hooks not registered');
  const templatesRoot = join(hooks.getUserDataPath(), 'templates');
  const lib = await import('@dimm-city/print-md');
  return lib.saveProjectAsTemplate({ projectDir, name, templatesRoot });
});
