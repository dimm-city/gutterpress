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
  /**
   * Pause the auto-snapshot debounce and `dir`'s auto-sync periodic timer
   * (#273 — around a copy switch's checkout, so neither fires against the
   * mid-switch working tree or pushes/commits the wrong branch). Optional:
   * only `vcs/switch-branch` calls it, and a fake without it is a no-op via
   * `?.()`.
   */
  pauseTimers?: (dir: string) => void;
  /** Re-arm the timers {@link pauseTimers} paused, once the switch settles
   *  (success or failure) — see its doc comment. */
  resumeTimers?: (dir: string) => void;
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
