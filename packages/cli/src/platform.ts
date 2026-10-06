/**
 * Platform abstraction contract (GitHub #41).
 *
 * The desktop talks to its host through ONE seam so that the app code never
 * branches on the host directly. The only host is Electron (IPC + native
 * dialogs).
 *
 * This module is **types only** — it is imported by the browser SPA via
 * `import type`, so it must never pull in a Node runtime dependency.
 *
 * Canonical home: `gutterpress`. The desktop re-exports these types
 * from `src/lib/platform/` and implements them in `electron-adapter.ts`.
 * Keep the implementation in lockstep with this contract.
 */

/**
 * The narrow set of host file primitives: raw file IO and filesystem
 * watching.
 *
 * Host RPC services that are *also* host-divergent (preview/build/doctor/prefs/
 * updater) are modelled separately as {@link HostServices} so this primitive
 * surface stays small and easy to reason about. The full thing the app consumes
 * is {@link Platform} = `PlatformAdapter & HostServices`.
 */
/**
 * Filesystem metadata for a single path (GitHub #44 — external-edit detection).
 * `mtimeMs` is the modification time in epoch milliseconds; `exists` is `false`
 * (with `mtimeMs`/`size` = 0) when the path is absent rather than throwing, so
 * the editor can distinguish "deleted out from under us" from a read error.
 */
export interface FileStat {
  mtimeMs: number;
  size: number;
  exists: boolean;
}

/**
 * Result of a successful {@link PlatformAdapter.writeFile} (GitHub #44). Carries
 * the post-write modification time so the editor can record the on-disk baseline
 * mtime without a follow-up `statFile` round-trip — this is what lets
 * external-edit detection suppress the self-echo of our own debounced save.
 */
export interface FileWriteResult {
  mtimeMs: number;
}

export interface PlatformAdapter {
  /**
   * Read a UTF-8 text file by absolute path.
   */
  readFile(path: string): Promise<string>;

  /**
   * Write a UTF-8 text file by absolute path, creating/overwriting it.
   * Resolves with the post-write {@link FileWriteResult} (`{ mtimeMs }`) so the
   * editor (#44) can record the on-disk baseline mtime.
   */
  writeFile(path: string, content: string): Promise<FileWriteResult>;

  /**
   * Stat a file by absolute path (GitHub #44). Used by the editor to confirm a
   * `watchFolder` event reflects a real on-disk change (mtime moved) versus the
   * self-echo of our own `writeFile`. Resolves with `exists: false` rather than
   * rejecting when the path is absent.
   */
  statFile(path: string): Promise<FileStat>;

  /**
   * Watch a folder for changes, invoking `cb` on each change.
   * @returns an unsubscribe function.
   */
  watchFolder(path: string, cb: () => void): () => void;
}
