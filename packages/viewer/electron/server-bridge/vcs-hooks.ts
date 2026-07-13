/**
 * Shared version-history hooks for vcs:* server routes.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getVcsHooks()` is a thin derived selector over it.
 */

import { getHostServices } from './host-services';

export interface VcsHooks<LibModule = unknown> {
  loadLib: () => Promise<LibModule>;
  operationLogPath: (slug: string) => string;
}

/**
 * The live `VcsHooks` slice of the collapsed host object, narrowed to
 * whatever generic view the caller asks for (same "narrow at the point of
 * use" pattern as `getPrefsHooks` — see its doc comment).
 */
export function getVcsHooks<LibModule = unknown>(): VcsHooks<LibModule> | null {
  const vcs = getHostServices()?.vcs;
  return (vcs as unknown as VcsHooks<LibModule> | undefined) ?? null;
}
