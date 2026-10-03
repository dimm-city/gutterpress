import { error } from '@sveltejs/kit';
import { createLastFlushFailure } from '$lib/persistence-failures';
import { defineRoute, getHostServices, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

type FlushFailureBody =
  | { action: 'record'; projectDir: string | null }
  | { action: 'acknowledge'; failedAt: string };

export const POST: RequestHandler = defineRoute<FlushFailureBody>({
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
  call: async ({ body }) => {
    if (body.action === 'record') {
      const marker = createLastFlushFailure(body.projectDir);
      await getHostServices().prefs.updatePrefs((current) => ({ ...current, lastFlushFailed: marker }));
      return marker;
    }

    let acknowledged = false;
    await getHostServices().prefs.updatePrefs((current) => {
      if (current.lastFlushFailed?.failedAt !== body.failedAt) return current;
      acknowledged = true;
      const next = { ...current };
      delete next.lastFlushFailed;
      return next;
    });
    return { acknowledged };
  },
});
