import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir, url } = await request.json().catch(() => ({})) as {
      projectDir?: string;
      url?: string;
    };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'theme/import-from-url requires an absolute projectDir');
    }
    if (typeof url !== 'string' || !url) {
      return error(400, 'theme/import-from-url requires a url');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.importThemeFromUrl(projectDir, url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
