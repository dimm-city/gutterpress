import { error } from '@sveltejs/kit';
import { defineRoute, loadApiLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; updates: Record<string, unknown> }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; updates?: Record<string, unknown> };
    const projectDir = requireAbsolute(body.projectDir, 'manifest/set-fields');
    if (!body.updates || typeof body.updates !== 'object') {
      error(400, 'manifest/set-fields requires an updates object');
    }
    return { projectDir, updates: body.updates };
  },
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.setManifestFields(body.projectDir, body.updates as Parameters<typeof lib.setManifestFields>[1]);
  },
});
