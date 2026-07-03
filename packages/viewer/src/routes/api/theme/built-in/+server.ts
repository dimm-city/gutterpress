import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = jsonRoute(async () => {
  const lib = await import('@dimm-city/print-md');
  return lib.listBuiltInThemes();
});
