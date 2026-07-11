import { error } from '@sveltejs/kit';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ filePath: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: (raw) => {
    const body = raw as { filePath?: string };
    if (!body.filePath) error(400, 'filePath is required');
    return { filePath: body.filePath };
  },
  call: async ({ body, hooks }) => {
    hooks.showItemInFolder(body.filePath);
    return { ok: true };
  },
});
