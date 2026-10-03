/**
 * Shared app-lifecycle hooks for app:* server routes. main.ts builds the
 * `AppHooks` object and passes it as the `app` field to `registerHostServices()`;
 * routes reach it through `getHostServices().app` (`./host-services.ts`).
 */

export interface AppHooks {
  /** Record the renderer's best-effort dirty-state hint (never a close safety gate). */
  setRendererDirty: (isDirty: boolean) => void;
  /**
   * Append one already-formatted failure line to the app's own diagnostic
   * log (electron/app-log.ts) — the file the start screen's Logs tab shows.
   * The shared error filters (server-bridge/friendly-errors.ts) call this for
   * every failure they log, so the "See the app log for details" they promise
   * is true from the SvelteKit routes' bundle too, not only from main.ts's.
   * Optional: absent (tests, or before main.ts wires it), logging stays
   * console-only.
   */
  logFailure?: (line: string) => void;
}
