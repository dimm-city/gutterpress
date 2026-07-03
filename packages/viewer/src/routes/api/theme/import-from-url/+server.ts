import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(
  async (body: { projectDir?: string; url?: string }) => {
    const { projectDir, url } = body;
    if (!projectDir || !isAbsolute(projectDir)) {
      error(400, 'theme/import-from-url requires an absolute projectDir');
    }
    if (typeof url !== 'string' || !url) {
      error(400, 'theme/import-from-url requires a url');
    }
    const lib = await import('@dimm-city/print-md');
    return lib.importThemeFromUrl(projectDir, url);
  }
);
