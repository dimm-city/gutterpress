/**
 * Shared write-side-effect hooks for fs:writeFile server route.
 *
 * Reached through `getHostServices().write` (`./host-services.ts`): the live
 * reference the route uses to trigger the auto-snapshot/sync debounce that
 * lives in main.
 */

import { getHostServices } from './host-services';
import { isWithinRoot } from './fs-guard';

export interface WriteHooks {
  scheduleAutoSnapshot: (dir: string) => void;
  scheduleAutoSync: (dir: string) => void;
  notifyPreviewSettledWrite: (filePath: string, writtenContent: string) => void;
  getWatchedDir: () => string | null;
  /**
   * The repository the open book belongs to, or null for a plain folder.
   *
   * A write anywhere in that repository is a change to the project's history —
   * see {@link scheduleAutoWriteEffects} for why the watcher's dir alone is
   * too narrow. Host-detected (`detectProjectSource`), never renderer-supplied,
   * exactly like the fs-guard's own repo root.
   */
  getRepositoryRoot: () => string | null;
}

/**
 * Fire the auto-snapshot + auto-sync debounce for a mutation at `targetPath`.
 *
 * Requires the folder watcher to be actively tracking a project — snapshot/sync
 * must not fire before a project is genuinely open — and the write to land
 * inside that project's WRITE SCOPE: the watched book, or the repository that
 * book belongs to.
 *
 * fs-route authorization covers the opened book PLUS its enclosing repo root
 * so a multi-book project can edit repo-root shared styles and assets; this
 * gate must match it, or such a write succeeds and arms NOTHING — a
 * shared-stylesheet edit would never enter version history or sync until some
 * later in-book save happened to arm the timer.
 *
 * The debounce is still SCHEDULED for the watched dir, not for whatever root
 * matched: the scheduler's own `getWatchedDir() !== dir` guard would drop any
 * other key, and a snapshot commits the whole repository regardless (R9). The
 * repo root widens which writes COUNT as an edit, not what gets committed.
 *
 * Shared by the five mutating fs/* routes (write-file, create-file,
 * create-folder, rename, delete).
 */
export function scheduleAutoWriteEffects(targetPath: string): void {
  const hooks = getHostServices().write;
  const watchedDir = hooks.getWatchedDir();
  if (!watchedDir) return;
  const repositoryRoot = hooks.getRepositoryRoot();
  const inWriteScope =
    isWithinRoot(targetPath, watchedDir) ||
    (repositoryRoot !== null && isWithinRoot(targetPath, repositoryRoot));
  if (!inWriteScope) return;
  hooks.scheduleAutoSnapshot(watchedDir);
  hooks.scheduleAutoSync(watchedDir);
}

/** Start preview regeneration immediately after the route's awaited write. */
export function notifyPreviewSettledWrite(targetPath: string, writtenContent: string): void {
  getHostServices().write.notifyPreviewSettledWrite(targetPath, writtenContent);
}
