import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { templatesRoot?: string }) => {
  let templatesRoot: string;
  if (typeof body.templatesRoot === 'string') {
    templatesRoot = body.templatesRoot;
  } else {
    const hooks = getDesktopHooks();
    if (!hooks) error(503, 'Desktop hooks not registered');
    templatesRoot = join(hooks.getUserDataPath(), 'templates');
  }
  const lib = await import('@dimm-city/print-md');
  return lib.listCustomTemplates(templatesRoot);
});
