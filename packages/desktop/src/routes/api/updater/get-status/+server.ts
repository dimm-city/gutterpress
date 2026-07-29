import { getUpdaterHooks, type UpdaterHooks } from '$lib/server/updater';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>, UpdaterHooks>({
  hooks: getUpdaterHooks,
  hooksUnavailableMessage: 'Updater hooks not registered',
  call: ({ hooks }) => hooks.getStatus(),
});
