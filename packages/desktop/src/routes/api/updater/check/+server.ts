import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// User-initiated (non-silent): failures are reported. The silent background
// check (app focus / launch) stays a direct call inside electron/main.ts.
export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: () => getHostServices().updater.check(),
});
