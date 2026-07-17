import { error } from '@sveltejs/kit';
import { isHttpUrl } from '../../../../../electron/navigation-policy';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ url: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: (raw) => {
    const body = raw as { url?: string };
    if (!body.url) error(400, 'url is required');
    // Only ever hand http(s) URLs to the OS (audit C1): the app's SINGLE
    // http(s)-only gate, shared with decideNavigation/decideWindowOpen and the
    // openExternal hook impl, so the policy can't drift across copies.
    if (!isHttpUrl(body.url)) {
      error(400, 'url must be http(s)');
    }
    return { url: body.url };
  },
  call: async ({ body, hooks }) => {
    await hooks.openExternal(body.url);
    return { ok: true };
  },
});
