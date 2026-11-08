import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * The default folder for "Open from online": the platform documents folder plus
 * "Gutterpress". Only reports the path; nothing is created here (the clone
 * creates it when it runs).
 */
export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: () => ({ path: getHostServices().remote.defaultCloneParent() }),
});
