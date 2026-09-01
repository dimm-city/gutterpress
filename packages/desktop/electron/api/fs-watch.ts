/**
 * `fs:watchFolder` / `fs:unwatchFolder` — IPC handlers for the "fs" bounded
 * context's workspace-watch surface (SFE-P6b: extracted from
 * electron/main.ts, which registered these two channels inline next to
 * `fsGuardImpl`).
 *
 * Unlike the rest of the fs:* channels (./fs.ts), these two are not pure
 * functions over their arguments — they read and drive the host's live
 * folder-watcher and the currently-open workspace, both of which are
 * main.ts-owned module state (`activeWorkspaceRoot`, the single
 * `FolderWatcher` instance, the auto-sync interval). main.ts passes them in
 * explicitly as `FsWatchRegistrarDeps` rather than this module reaching back
 * into main.ts's private scope.
 *
 * P1 review (PR #98, maintainer itlackey): `fs:watchFolder` used to accept
 * ANY absolute path from the renderer (only guard: `path.isAbsolute`), and
 * `fsGuardImpl.projectRoots()` (electron/main.ts, unchanged by this move)
 * used to union in whatever the watcher was tracking — so a same-origin
 * script could call `watchFolder("/home/user/.ssh")` and have that directory
 * authorized as a project root for the generic fs routes. The watcher exists
 * ONLY to watch the already-open project, so `fs:watchFolder` is gated on
 * the host-set `getActiveWorkspaceRoot()`, never on renderer-supplied input
 * — see tests/platform/watch-folder-scoping.test.ts for the regression
 * coverage (source-text assertions against this file, ported from main.ts by
 * this same run).
 */
import path from "node:path";
import type { SecureHandle } from "../server-bridge/secure-handle";

export interface FsWatchRegistrarDeps {
  getActiveWorkspaceRoot(): string | null;
  startFolderWatch(dirPath: string): void;
  stopFolderWatch(): void;
  getWatchedDir(): string | null;
  armSyncInterval(dir: string): void;
}

/**
 * Register `fs:watchFolder`/`fs:unwatchFolder`.
 *
 * Backs external-edit detection: a shallow fs.watch on the open project
 * whose debounced changes are pushed to the renderer as `fs:folderChanged`.
 * Only one project is open at a time, so subscribing replaces any prior
 * watch.
 */
export function registerFsWatchHandlers(secureHandle: SecureHandle, deps: FsWatchRegistrarDeps): void {
  secureHandle("fs:watchFolder", async (_e, dirPath: string): Promise<void> => {
    if (!path.isAbsolute(dirPath)) {
      throw new Error(`fs:watchFolder requires an absolute path, got: ${dirPath}`);
    }
    // See this module's header (P1 review, PR #98): the watcher exists ONLY
    // to watch the already-open project, so it is gated on the host-set
    // active workspace root, never on renderer-supplied input — matching
    // fsGuardImpl.projectRoots()'s sole authorization source.
    const activeWorkspaceRoot = deps.getActiveWorkspaceRoot();
    if (!activeWorkspaceRoot || path.resolve(dirPath) !== activeWorkspaceRoot) {
      throw new Error(
        `fs:watchFolder: dirPath must be the active workspace directory (got: ${dirPath})`,
      );
    }
    deps.startFolderWatch(dirPath);
    // Arm the periodic safety-sync interval NOW — the watcher is live, so
    // armInterval's watched-dir guard finally holds. The open-time arm
    // (PreviewOpenController.runOpen → armSyncInterval) fires BEFORE the
    // renderer calls fs:watchFolder, so its guard saw the previous project (or
    // null) and silently no-opped; and even a lucky arm was wiped by
    // FolderWatcher.start()'s stop() → onStop → autoSync.cancelAll() just now.
    // Net effect pre-fix: a view-only session NEVER pulled teammate changes —
    // the interval only ever started after the first local edit. (Reopening the
    // SAME dir skipped the wipe, which is why sync seemed intermittent.)
    void deps.armSyncInterval(deps.getWatchedDir() ?? path.resolve(dirPath));
  });

  secureHandle("fs:unwatchFolder", async (_e, dirPath: string): Promise<void> => {
    const normalized = path.resolve(dirPath);
    if (deps.getWatchedDir() === normalized) deps.stopFolderWatch();
  });
}
