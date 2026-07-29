import { defineRoute } from '../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute({
  call: async () => ({ name: '@dimm-city/gutterpress-desktop', runtime: 'node', ok: true }),
});
