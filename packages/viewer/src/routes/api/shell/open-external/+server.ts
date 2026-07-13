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
    return { url: body.url };
  },
  call: async ({ body, hooks }) => {
    await hooks.openExternal(body.url);
    return { ok: true };
  },
});
