import { error } from '@sveltejs/kit';
import { logAppError } from '../../../../../electron/app-log';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Record a renderer-side error in the app log (see `$lib/diagnostics/report`). */
export const POST: RequestHandler = defineRoute<{ message: string }>({
  validate: (raw) => {
    const message = (raw as { message?: unknown }).message;
    if (typeof message !== 'string' || !message) error(400, "log/renderer-error: 'message' is required");
    return { message: message.slice(0, 8000) };
  },
  call: async ({ body }) => {
    await logAppError(`[renderer] ${body.message}`);
    return { ok: true };
  },
});
