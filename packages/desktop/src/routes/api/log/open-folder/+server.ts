import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Open the diagnostic logs folder in the OS file manager (no renderer path). */
export const POST: RequestHandler = defineRoute<unknown>({
  call: async () => {
    await getHostServices().desktop.openLogsFolder();
    return { ok: true };
  },
});
