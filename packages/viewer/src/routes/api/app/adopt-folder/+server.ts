import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

interface AdoptFolderLibModule {
  adoptFolder: (opts: unknown) => Promise<unknown>;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const options = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!options || typeof options.dir !== 'string' || !path.isAbsolute(options.dir as string)) {
      return error(400, 'adoptFolder requires an absolute { dir }');
    }
    const hooks = getPrefsHooks<AdoptFolderLibModule>();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    return json(await lib.adoptFolder(options));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
