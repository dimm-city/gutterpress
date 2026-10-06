import { defineRoute, getHostServices, requireAbsolute } from '../../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute(
      (raw as { projectDir?: string }).projectDir,
       'app/gutterpress-project-state:get',
    ),
  }),
  call: async ({ body }) => {
    const { prefs } = getHostServices();
    const state = prefs.readProjectState((await prefs.readPrefs()).projectStates, body.projectDir);
    return state ?? null;
  },
});
