import { error } from '@sveltejs/kit';
import path from 'node:path';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

interface AdoptFolderLibModule {
  adoptFolder: (opts: unknown) => Promise<unknown>;
}

export const POST: RequestHandler = jsonRoute(async (options: Record<string, unknown>) => {
  if (!options || typeof options.dir !== 'string' || !path.isAbsolute(options.dir)) {
    error(400, 'adoptFolder requires an absolute { dir }');
  }
  const hooks = getPrefsHooks<AdoptFolderLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const lib = await hooks.loadLib();
  return lib.adoptFolder(options);
});
