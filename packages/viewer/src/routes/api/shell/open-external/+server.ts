import { error } from '@sveltejs/kit';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ url: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: (raw) => {
    const body = raw as { url?: string };
    if (!body.url) error(400, 'url is required');
    // Only ever hand http(s) URLs to the OS (audit C1). This matches the same
    // http(s)-only gate navigation-policy.ts applies to the app's other two
    // shell.openExternal paths — a foreign scheme (file:, mailto:, custom
    // handlers) must not be launchable through this route.
    if (!/^https?:\/\//i.test(body.url)) {
      error(400, 'url must be http(s)');
    }
    return { url: body.url };
  },
  call: async ({ body, hooks }) => {
    await hooks.openExternal(body.url);
    return { ok: true };
  },
});
