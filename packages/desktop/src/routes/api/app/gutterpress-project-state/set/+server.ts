import { defineRoute, getHostServices, requireAbsolute } from '../../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; state: Record<string, unknown> }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; state?: Record<string, unknown> };
    return {
      projectDir: requireAbsolute(body.projectDir, 'app/gutterpress-project-state:set'),
      state: body.state ?? {},
    };
  },
  call: async ({ body }) => {
    const { prefs } = getHostServices();
    await prefs.updatePrefs((current) => ({
      ...current,
      lastProjectDir: body.projectDir,
      projectStates: prefs.writeProjectState(current.projectStates, body.projectDir, body.state),
    }));
    return { ok: true };
  },
});
