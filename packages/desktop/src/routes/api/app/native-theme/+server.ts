import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => getHostServices().desktop.getNativeTheme(),
});
