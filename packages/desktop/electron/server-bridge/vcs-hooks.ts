/**
 * Shared version-history hooks for vcs:* server routes.
 * Routes reach them through `getHostServices().vcs` (`./host-services.ts`);
 * the lib itself comes from `loadLib()` in `src/routes/api/_lib/route.ts`.
 */

export interface VcsHooks {
  operationLogPath: (slug: string) => string;
  /** A fresh folder for one "Repair online backup" to keep the old `.git` in. */
  repairBackupDir: (slug: string) => string;
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
