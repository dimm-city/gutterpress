import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

interface CreateProjectLibModule {
  scaffoldProject: (opts: unknown) => Promise<unknown>;
}

export const POST: RequestHandler = jsonRoute(async (options: Record<string, unknown>) => {
  if (!options || typeof options.name !== 'string' || typeof options.parentDir !== 'string') {
    error(400, 'createProject requires { name, parentDir }');
  }
  const hooks = getPrefsHooks<CreateProjectLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const lib = await hooks.loadLib();
  return lib.scaffoldProject(options);
});
