import { error } from '@sveltejs/kit';
import { createLastFlushFailure } from '$lib/persistence-failures';
import type { ViewerPrefs } from '$lib/platform/contract';
import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

type FlushFailureBody =
  | { action: 'record'; projectDir: string | null }
  | { action: 'acknowledge'; failedAt: string };
type FlushFailureHooks = PrefsHooks<unknown, ViewerPrefs>;

export const POST: RequestHandler = defineRoute<FlushFailureBody, FlushFailureHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  validate: (raw) => {
    const body = raw as { action?: unknown; projectDir?: unknown; failedAt?: unknown };
    if (body.action === 'record') {
      return {
        action: 'record',
        projectDir:
          body.projectDir == null
            ? null
            : requireAbsolute(body.projectDir, 'app/flush-failure:record'),
      };
    }
    if (body.action === 'acknowledge' && typeof body.failedAt === 'string' && body.failedAt) {
      return { action: 'acknowledge', failedAt: body.failedAt };
    }
    error(400, 'app/flush-failure requires record or acknowledge details');
  },
  call: async ({ body, hooks }) => {
    if (body.action === 'record') {
      const marker = createLastFlushFailure(body.projectDir);
      await hooks.updatePrefs((current) => ({ ...current, lastFlushFailed: marker }));
      return marker;
    }

    let acknowledged = false;
    await hooks.updatePrefs((current) => {
      if (current.lastFlushFailed?.failedAt !== body.failedAt) return current;
      acknowledged = true;
      const next = { ...current };
      delete next.lastFlushFailed;
      return next;
    });
    return { acknowledged };
  },
});
