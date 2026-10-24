import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Close the version preview opened by `open-version-preview`; a no-op when none is open. */
export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    await getHostServices().vcs.closeVersionPreview();
    return { closed: true as const };
  },
});
