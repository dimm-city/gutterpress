import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Native Save / Don't Save / Cancel prompt for leaving a file with unsaved
 * edits while "Save edits automatically" is off. Returns the author's choice.
 */
export const POST: RequestHandler = defineRoute<{ fileName?: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  call: async ({ hooks, body }) =>
    hooks.confirmUnsavedChanges(typeof body.fileName === 'string' ? body.fileName : null),
});
