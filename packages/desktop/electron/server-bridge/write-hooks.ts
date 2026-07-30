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
  /**
   * The repository the open book belongs to, or null for a plain folder.
   *
   * A write anywhere in that repository is a change to the project's history —
   * see {@link scheduleAutoWriteEffects} for why the watcher's dir alone was
   * too narrow. Host-detected (`detectProjectSource`), never renderer-supplied,
   * exactly like the fs-guard's own repo root.
   */
  getRepositoryRoot: () => string | null;
}

/** The live `WriteHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getWriteHooks(): WriteHooks | null {
  return getHostServices()?.write ?? null;
}

/**
 * Fire the auto-snapshot + auto-sync debounce for a mutation at `targetPath`.
 *
 * Requires the folder watcher to be actively tracking a project — snapshot/sync
 * must not fire before a project is genuinely open — and the write to land
 * inside that project's WRITE SCOPE: the watched book, or the repository that
 * book belongs to.
 *
 * The repository half was missing (2026-07-29 audit). fs-route authorization
 * was widened to the opened book PLUS its enclosing repo root (commit c310e2)
 * precisely so a multi-book project can edit repo-root shared styles and
 * assets — but this gate still asked only about the watched book, so those
 * writes succeeded and then armed NOTHING: a shared-stylesheet edit never
 * entered version history and never synced until some later in-book save
 * happened to arm the timer. Writes were allowed under the repo root while only
 * book writes counted as edits — two halves of one feature disagreeing.
 *
 * The debounce is still SCHEDULED for the watched dir, not for whatever root
 * matched: the scheduler's own `getWatchedDir() !== dir` guard would drop any
 * other key, and a snapshot commits the whole repository regardless (R9). What
 * widens here is which writes COUNT as an edit, not what gets committed.
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
  if (!watchedDir) return;
  const repositoryRoot = hooks.getRepositoryRoot();
  const inWriteScope =
    isWithinRoot(targetPath, watchedDir) ||
    (repositoryRoot !== null && isWithinRoot(targetPath, repositoryRoot));
  if (!inWriteScope) return;
  hooks.scheduleAutoSnapshot(watchedDir);
  hooks.scheduleAutoSync(watchedDir);
}
