import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; url: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; url?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'theme/import-from-url');
    if (typeof body.url !== 'string' || !body.url) {
      error(400, 'theme/import-from-url requires a url');
    }
    return { projectDir, url: body.url };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.importThemeFromUrl(body.projectDir, body.url);
  },
});
