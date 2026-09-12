import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// Import a look from an http(s) URL (a raw `.css`, or a folder URL holding
// theme.css + optional theme.json). The lib refuses non-http(s) schemes.
export const POST: RequestHandler = defineRoute<{ projectDir: string; url: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; url?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/import-from-url');
    if (typeof body.url !== 'string' || !body.url.trim()) {
      error(400, 'extension/import-from-url requires a url');
    }
    return { projectDir, url: body.url.trim() };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.importExtensionFromUrl(body.projectDir, body.url);
  },
});
