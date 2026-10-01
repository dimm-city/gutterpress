import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Open the diagnostic logs folder in the OS file manager (no renderer path). */
export const POST: RequestHandler = defineRoute<unknown, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  call: async ({ hooks }) => {
    await hooks.openLogsFolder();
    return { ok: true };
  },
});
