/**
 * Shared write-side-effect hooks for fs:writeFile server route.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getWriteHooks()` is a thin derived selector over
 * it, retrieving the live reference the route uses to trigger the
 * auto-snapshot/sync debounce that lives in main.
 */

import { getHostServices } from './host-services';
import { isWithinRoot } from './fs-guard';

export interface WriteHooks {
  scheduleAutoSnapshot: (dir: string) => void;
  scheduleAutoSync: (dir: string) => void;
  getWatchedDir: () => string | null;
}

/** The live `WriteHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getWriteHooks(): WriteHooks | null {
  return getHostServices()?.write ?? null;
}

/**
 * Fire the auto-snapshot + auto-sync debounce for a mutation at `targetPath`,
 * but ONLY when the folder watcher is actively tracking the write's dir. This
 * is a NARROWER check than route authorization (`requireWithinProjectRoot`,
 * which also allows the active-preview dir before watching starts) — snapshot/
 * sync should only fire once the watcher is genuinely tracking the target.
 *
 * Extracted (audit E2) from the five mutating fs/* routes (write-file,
 * create-file, create-folder, rename, delete) that hand-copied this exact
 * eight-line block — the `writeHooks` vs `hooks` naming drift between copies
 * confirmed it was pasted, not shared.
 */
export function scheduleAutoWriteEffects(targetPath: string): void {
  const hooks = getWriteHooks();
  if (!hooks) return;
  const watchedDir = hooks.getWatchedDir();
  if (watchedDir && isWithinRoot(targetPath, watchedDir)) {
    hooks.scheduleAutoSnapshot(watchedDir);
    hooks.scheduleAutoSync(watchedDir);
  }
}
