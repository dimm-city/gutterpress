/**
 * folder-watch/watcher.ts — the single shallow project folder watcher, extracted
 * from electron/main.ts as an injectable, unit-testable class.
 *
 * WHY THIS EXISTS
 * ---------------
 * The open project is watched by ONE non-recursive `fs.watch`. `fs.watch` is
 * coarse (fires rename + change per save), so a change is debounced before the
 * renderer is notified, and `.git`-internal writes (from automatic snapshots)
 * are filtered so they never re-trigger preview reloads / re-arm timers. This
 * lived in main.ts as a pair of free functions (`startFolderWatch` /
 * `stopFolderWatch`) over module globals (`folderWatcher`, `watchedDir`,
 * `folderChangeDebounce`), which made the single-watcher / same-dir short-circuit
 * / debounce / `.git` filter / stop-old-before-new invariants impossible to
 * unit-test without a live Electron + fs stack.
 *
 * This class owns the exact same control logic, but every external touch-point —
 * the `fs.watch` factory, path normalization, the folder-changed notification,
 * the per-edit signal (auto-snapshot + auto-sync debounce), the stop-flush, and
 * the clock — is INJECTED via `deps`, so tests drive it with fakes. Mirroring
 * AutoSnapshotScheduler / AutoSyncOrchestrator, the class owns the watcher +
 * debounce + normalized watched dir; main.ts keeps thin `startFolderWatch` /
 * `stopFolderWatch` delegators and a module-level MIRROR of `watchedDir` (updated
 * ONLY via `onWatchedDirChanged`) so the many off-limits reads stay byte-identical.
 *
 * The behavior is a faithful move of the original main.ts code: the guards, the
 * filename normalization, the `.git` filter, the 150ms debounce, the try/catch,
 * and the set/clear ordering are preserved verbatim.
 *
 * Node/host-side ONLY — never imported by the renderer.
 */

import type { FSWatcher } from "node:fs";

/** External touch-points injected into the watcher (all faked in tests). */
export interface FolderWatcherDeps {
  /** Start a non-recursive fs.watch on `dir`. Real code uses node:fs `watch`. */
  watch: (
    dir: string,
    options: { recursive: boolean },
    cb: (event: string, filename: string | Buffer | null) => void,
  ) => FSWatcher;
  /** Normalize a path to its canonical (resolved) form. Real code: path.resolve. */
  resolve: (p: string) => string;
  /** A debounced folder-change reached the renderer (`fs:folderChanged`). */
  onFolderChanged: (name: string) => void;
  /** An edit signal fired IMMEDIATELY per event, keyed by the normalized dir
   *  (arms the auto-snapshot + auto-sync debounces). */
  onEditSignal: (normalizedDir: string) => void;
  /** Project switch/close flush point (flush pending snapshot + cancel sync timers). */
  onStop: () => void;
  /** Injectable timer arm. Real code uses setTimeout; tests fake it. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Injectable timer clear. Real code uses clearTimeout; tests fake it. */
  clearTimer?: (h: unknown) => void;
  /** Fires on every watchedDir set (dir) / clear (null) so a caller can mirror it. */
  onWatchedDirChanged?: (dir: string | null) => void;
}

/** Default timer arm: a plain setTimeout (the folder-change debounce is short-lived
 *  and is always cleared on stop, so it is intentionally NOT unref'd — byte-identical
 *  to the original main.ts `folderChangeDebounce = setTimeout(...)`). */
function defaultSetTimer(cb: () => void, ms: number): unknown {
  return setTimeout(cb, ms);
}

function defaultClearTimer(h: unknown): void {
  clearTimeout(h as NodeJS.Timeout);
}

export class FolderWatcher {
  /** The single OS watcher for the open project, or null when idle. */
  private watcher: FSWatcher | null = null;
  /** The normalized (resolved) directory currently watched, or null. */
  private watchedDir: string | null = null;
  /** The single armed folder-change debounce handle, or null. */
  private debounce: unknown = null;

  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly deps: FolderWatcherDeps) {
    this.setTimer = deps.setTimer ?? defaultSetTimer;
    this.clearTimer = deps.clearTimer ?? defaultClearTimer;
  }

  /** The normalized directory currently watched, or null when idle. */
  getWatchedDir(): string | null {
    return this.watchedDir;
  }

  private setWatchedDir(dir: string | null): void {
    this.watchedDir = dir;
    this.deps.onWatchedDirChanged?.(dir);
  }

  /**
   * Watch `dirPath` (non-recursive). Normalizes the path first; a no-op if the
   * same dir is already watched. Switching dirs stops the old watcher first.
   */
  start(dirPath: string): void {
    // Normalise so autoSyncStates map keys are consistent (the export gate and all
    // other callers must use the same key — see issue #3 fix note below).
    const normalizedDir = this.deps.resolve(dirPath);
    if (this.watchedDir === normalizedDir && this.watcher) return;
    this.stop();
    this.setWatchedDir(normalizedDir);
    try {
      this.watcher = this.deps.watch(dirPath, { recursive: false }, (_event, filename) => {
        // fs.watch is noisy (fires on rename + change). Debounce so a single
        // external save produces one renderer notification.
        const name =
          typeof filename === "string"
            ? filename
            : filename
              ? Buffer.from(filename).toString()
              : "";
        // Git-internal writes are NOT content changes (RC1-3): the automatic
        // snapshot itself mutates `.git`, and treating that as an edit would
        // re-trigger preview reloads and re-arm the snapshot timer forever.
        // (The watch is non-recursive, so `.git` is the only segment we see.)
        if (name === ".git" || name.startsWith(".git/") || name.startsWith(".git\\")) {
          return;
        }
        if (this.debounce) this.clearTimer(this.debounce);
        this.debounce = this.setTimer(() => {
          this.deps.onFolderChanged(name);
        }, 150);
        // Edit signal: external editors and in-app saves both land here.
        // Use normalizedDir (the resolved form) so the map key matches watchedDir.
        this.deps.onEditSignal(normalizedDir);
      });
    } catch (e) {
      console.error(`[watch] failed to watch ${dirPath}:`, e);
      this.watcher = null;
      this.setWatchedDir(null);
    }
  }

  /** Stop the watcher, clear the debounce, flush pending work, and null watchedDir. */
  stop(): void {
    // Project switch/close flush point (RC1-3): edits were pending a snapshot —
    // take it now (fire-and-forget) instead of dropping the timer. Also cancels
    // all sync timers when the watched folder changes (project switch/close).
    this.deps.onStop();
    if (this.debounce) {
      this.clearTimer(this.debounce);
      this.debounce = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.setWatchedDir(null);
  }
}
