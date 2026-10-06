import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Native Save / Don't Save / Cancel prompt for leaving a file with unsaved
 * edits while "Save edits automatically" is off. Returns the author's choice.
 */
export const POST: RequestHandler = defineRoute<{ fileName?: string }>({
  call: async ({ body }) =>
    getHostServices().desktop.confirmUnsavedChanges(typeof body.fileName === 'string' ? body.fileName : null),
});
