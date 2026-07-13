import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; ref: string; enabled: boolean }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; ref?: string; enabled?: boolean };
    const projectDir = requireAbsolute(body.projectDir, 'plugin/set-enabled');
    if (typeof body.ref !== 'string') {
      error(400, 'plugin/set-enabled requires a ref string');
    }
    return { projectDir, ref: body.ref, enabled: Boolean(body.enabled) };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.setPluginEnabled(body.projectDir, body.ref, body.enabled);
    return { ok: true };
  },
});
