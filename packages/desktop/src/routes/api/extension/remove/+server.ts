import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #265: drop one manifest entry by its `use`. An npm entry's vendored copy
// (Gutterpress's own private tree) is deleted with it; a path entry's folder
// is the author's and is never touched. `use` is matched against the manifest
// by the lib, so the renderer can only name something already configured.
export const POST: RequestHandler = defineRoute<{ projectDir: string; use: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; use?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/remove');
    if (typeof body.use !== 'string' || !body.use.trim()) {
      error(400, 'extension/remove requires a use string');
    }
    return { projectDir, use: body.use };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.removeExtension(body.projectDir, body.use);
    return { ok: true };
  },
});
