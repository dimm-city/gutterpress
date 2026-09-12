import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; use: string; enabled: boolean }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; use?: string; enabled?: boolean };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/set-enabled');
    if (typeof body.use !== 'string' || !body.use.trim()) {
      error(400, 'extension/set-enabled requires a use string');
    }
    return { projectDir, use: body.use, enabled: Boolean(body.enabled) };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.setExtensionEnabled(body.projectDir, body.use, body.enabled);
    return { ok: true };
  },
});
