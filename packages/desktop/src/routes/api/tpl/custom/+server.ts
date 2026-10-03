import { join } from 'node:path';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ templatesRoot?: string }>({
  // The host's userData templates folder is only consulted when the body
  // omits templatesRoot.
  validate: (raw) => raw as { templatesRoot?: string },
  call: async ({ body }) => {
    let templatesRoot: string;
    if (typeof body.templatesRoot === 'string') {
      templatesRoot = body.templatesRoot;
    } else {
      templatesRoot = join(getHostServices().desktop.getUserDataPath(), 'templates');
    }
    const lib = await loadLib();
    return lib.listCustomTemplates(templatesRoot);
  },
});
