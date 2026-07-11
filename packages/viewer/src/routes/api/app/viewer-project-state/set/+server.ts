import { getPrefsHooks, type PrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute, requireAbsolute } from '../../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { projectDir: string; state: Record<string, unknown> },
  PrefsHooks
>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  validate: (raw) => {
    const body = raw as { projectDir?: string; state?: Record<string, unknown> };
    return {
      projectDir: requireAbsolute(body.projectDir, 'app/viewer-project-state:set'),
      state: body.state ?? {},
    };
  },
  call: async ({ body, hooks }) => {
    await hooks.updatePrefs((current) => ({
      ...current,
      lastProjectDir: body.projectDir,
      projectStates: hooks.writeProjectState(
        current.projectStates as Record<string, unknown> | undefined,
        body.projectDir,
        body.state,
      ),
    }));
    return { ok: true };
  },
});
