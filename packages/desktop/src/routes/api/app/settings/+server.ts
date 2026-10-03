import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => getHostServices().prefs.readSettings(),
});

export const POST: RequestHandler = defineRoute<Record<string, unknown>>({
  call: async ({ body }) => {
    // Atomic read-merge-write (audit A2): a bare readSettings()+writeSettings()
    // pair here raced concurrent setting changes and silently reverted one.
    await getHostServices().prefs.updateSettings(body);
    return { ok: true };
  },
});
