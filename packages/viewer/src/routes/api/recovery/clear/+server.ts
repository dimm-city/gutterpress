import { getRecoveryHooks, type RecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ filePath: string }, RecoveryHooks>({
  hooks: getRecoveryHooks,
  hooksUnavailableMessage: 'Recovery hooks not registered',
  validate: (raw) => ({
    filePath: requireAbsolute((raw as { filePath?: string }).filePath, 'recovery:clear'),
  }),
  call: async ({ body, hooks }) => hooks.clear(body.filePath),
});
