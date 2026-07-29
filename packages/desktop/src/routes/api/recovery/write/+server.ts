import { error } from '@sveltejs/kit';
import { getRecoveryHooks, type RecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { filePath: string; content: string; baseMtimeMs: number },
  RecoveryHooks
>({
  hooks: getRecoveryHooks,
  hooksUnavailableMessage: 'Recovery hooks not registered',
  validate: (raw) => {
    const body = raw as { filePath?: string; content?: string; baseMtimeMs?: number };
    if (body.content === undefined) error(400, 'content is required');
    if (typeof body.baseMtimeMs !== 'number') error(400, 'baseMtimeMs must be a number');
    return {
      filePath: requireAbsolute(body.filePath, 'recovery:write'),
      content: body.content,
      baseMtimeMs: body.baseMtimeMs,
    };
  },
  call: async ({ body, hooks }) => hooks.write(body.filePath, body.content, body.baseMtimeMs),
});
