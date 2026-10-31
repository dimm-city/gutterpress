/**
 * Shared version-history hooks for vcs:* server routes.
 * Routes reach them through `getHostServices().vcs` (`./host-services.ts`);
 * the lib itself comes from `loadLib()` in `src/routes/api/_lib/route.ts`.
 */

export interface VcsHooks {
  operationLogPath: (slug: string) => string;
  /** A fresh folder for one "Repair the online copy" to keep the old `.git` in. */
  repairBackupDir: (slug: string) => string;
  /**
   * Pause the auto-snapshot debounce and `dir`'s auto-sync periodic timer
   * (#273 — around a revision switch's checkout, so neither fires against the
   * mid-switch working tree or pushes/commits the wrong branch). Optional:
   * only the revision routes call it, and a fake without it is a no-op via
   * `?.()`.
   */
  pauseTimers?: (dir: string) => void;
  /** Re-arm the timers {@link pauseTimers} paused, once the switch settles
   *  (success or failure) — see its doc comment. */
  resumeTimers?: (dir: string) => void;
  /**
   * The open revision, or the versions saved on it, may have changed (a version
   * saved, another revision opened): re-check whether versions are waiting to go
   * online and tell the status bar. Refs only, no network; optional like
   * {@link pauseTimers}.
   */
  refreshOnlineStatus?: (dir: string) => void;
  /**
   * Version history's Pages (#408): render version `id` of the open book
   * read-only, from a scratch copy of its files, and return the preview URL
   * for a second frame. Replaces any version preview already open; `null`
   * when a later open or close replaced this one before it started.
   */
  openVersionPreview: (projectDir: string, id: string) => Promise<{ url: string } | null>;
  /** Stop the version preview and drop its scratch copy. No-op when none is open. */
  closeVersionPreview: () => Promise<void>;
}
