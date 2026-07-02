import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

interface CreateProjectLibModule {
  scaffoldProject: (opts: unknown) => Promise<unknown>;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const options = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!options || typeof options.name !== 'string' || typeof options.parentDir !== 'string') {
      return error(400, 'createProject requires { name, parentDir }');
    }
    const hooks = getPrefsHooks<CreateProjectLibModule>();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    return json(await lib.scaffoldProject(options));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
