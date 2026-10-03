/**
 * Shared auto-sync settings hook for the sync:setAutoSync server route
 * (ARCH review #8 — migrated off IPC; it was a pure settings write with no
 * push stream or live-BrowserWindow need).
 * Routes reach it through `getHostServices().sync` (`./host-services.ts`).
 */

export interface SyncSettingsHooks {
  /**
   * Persist the auto-sync master switch and (bound in main.ts) re-arm or
   * cancel the orchestrator's periodic timer for the currently open project —
   * the exact side effects the old `sync:setAutoSync` IPC handler performed
   * inline.
   */
  setAutoSync(enabled: boolean): Promise<{ ok: true; autoSync: boolean }>;
  /**
   * The last "sync:status" payload emitted for `projectDir`, or null when none
   * has been emitted this session. The queryable counterpart to the
   * fire-and-forget push channel: the status pill seeds itself from this right
   * after subscribing, so a subscription that lands after an emit (project
   * open races the pill's mount; the one-shot "connect"/"local" states) no
   * longer strands on blank/stale status.
   */
  getStatus(projectDir: string): Promise<object | null>;
}
