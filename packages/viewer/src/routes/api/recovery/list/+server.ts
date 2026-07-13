import { getRecoveryHooks, type RecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }, RecoveryHooks>({
  hooks: getRecoveryHooks,
  hooksUnavailableMessage: 'Recovery hooks not registered',
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'recovery:list'),
  }),
  call: async ({ body, hooks }) => hooks.list(body.projectDir),
});
