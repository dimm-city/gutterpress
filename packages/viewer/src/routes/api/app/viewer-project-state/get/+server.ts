import { getPrefsHooks, type PrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute, requireAbsolute } from '../../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  validate: (raw) => ({
    projectDir: requireAbsolute(
      (raw as { projectDir?: string }).projectDir,
      'app/viewer-project-state:get',
    ),
  }),
  call: async ({ body, hooks }) => {
    const prefs = await hooks.readPrefs();
    const state = hooks.readProjectState(prefs.projectStates as Record<string, unknown> | undefined, body.projectDir);
    return state ?? null;
  },
});
