import { error } from '@sveltejs/kit';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, unknown>>({
  validate: (raw) => {
    const options = raw as Record<string, unknown>;
    if (!options || typeof options.name !== 'string' || typeof options.parentDir !== 'string') {
      error(400, 'createProject requires { name, parentDir }');
    }
    return options;
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.scaffoldProject(body as unknown as Parameters<typeof lib.scaffoldProject>[0]);
  },
});
