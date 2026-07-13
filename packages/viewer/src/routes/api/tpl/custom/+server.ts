import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { getDesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ templatesRoot?: string }>({
  // Only needed when the body omits templatesRoot — resolved lazily inside call
  // (not via the standard `hooks` 503 gate) so a caller that always passes an
  // explicit templatesRoot never depends on desktop hooks being registered.
  validate: (raw) => raw as { templatesRoot?: string },
  call: async ({ body }) => {
    let templatesRoot: string;
    if (typeof body.templatesRoot === 'string') {
      templatesRoot = body.templatesRoot;
    } else {
      const hooks = getDesktopHooks();
      if (!hooks) error(503, 'Desktop hooks not registered');
      templatesRoot = join(hooks.getUserDataPath(), 'templates');
    }
    const lib = await loadLib();
    return lib.listCustomTemplates(templatesRoot);
  },
});
