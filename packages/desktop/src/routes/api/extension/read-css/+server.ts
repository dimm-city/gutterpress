import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// A configured extension's stylesheets, concatenated in cascade order, for
// the Looks & features tab's sample thumbnail and the Design tab's token list. A
// bundled look answers from its inlined css; otherwise the folder is resolved
// from the MANIFEST entry `use` names (never from a client-supplied path), and
// an entry with no folder (uninstalled, missing) throws — the caller shows a
// fallback.
export const POST: RequestHandler = defineRoute<{ projectDir: string; use: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; use?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/read-css');
    if (typeof body.use !== 'string' || !body.use.trim()) {
      error(400, 'extension/read-css requires a use string');
    }
    return { projectDir, use: body.use };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.readExtensionCss(body.projectDir, body.use);
  },
});
