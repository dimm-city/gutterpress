/**
 * Platform abstraction contract (GitHub #41).
 *
 * The desktop talks to its host through ONE seam so that the app code never
 * branches on `electron` vs `web` directly. Today the only host is Electron
 * (IPC + native dialogs). When the PWA lands (0.6.0, #...), a `WebAdapter`
 * backed by the File System Access API drops in behind the same interface and
 * the app code does not change.
 *
 * This module is **types only** — it is imported by the browser SPA via
 * `import type`, so it must never pull in a Node runtime dependency.
 *
 * Canonical home: `gutterpress`. The desktop re-exports these types
 * from `src/lib/platform/` and implements them in `electron-adapter.ts` /
 * `web-adapter.ts`. Keep the implementations in lockstep with this contract.
 */

/**
 * The narrow set of capabilities whose implementation genuinely differs between
 * a desktop (Electron) host and a browser (PWA) host: native dialogs, raw file
 * IO, filesystem watching, and OS-keychain-backed secrets.
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
  /** Which host backs this adapter. Lets the rare unavoidable branch be explicit. */
  readonly platform: "electron" | "web";

  /**
   * Prompt the user to choose a project folder.
   * @returns the absolute path, or `null` if the user cancelled.
   * Electron: native directory dialog. Web: File System Access API.
   */
  openFolder(): Promise<string | null>;

  /**
   * Read a UTF-8 text file by absolute path.
   * Editor seam for #38/#39 — no current consumer in 0.4.0.
   */
  readFile(path: string): Promise<string>;

  /**
   * Write a UTF-8 text file by absolute path, creating/overwriting it.
   * Resolves with the post-write {@link FileWriteResult} (`{ mtimeMs }`) so the
   * editor (#44) can record the on-disk baseline mtime; callers that ignore the
   * value are unaffected (additive widening — was `Promise<void>`).
   */
  writeFile(path: string, content: string): Promise<FileWriteResult>;

  /**
   * List the immediate entries of a directory (single level, no recursion).
   * @returns each entry's `name`, absolute `path`, and whether it `isDir`.
   * Editor seam for #38 (file-tree sidebar). Electron: `node:fs/promises`
   * `readdir`. Web: File System Access API (0.6.0).
   */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>;

  /**
   * Stat a file by absolute path (GitHub #44). Used by the editor to confirm a
   * `watchFolder` event reflects a real on-disk change (mtime moved) versus the
   * self-echo of our own `writeFile`. Resolves with `exists: false` rather than
   * rejecting when the path is absent. Web throws until 0.6.0 (FS Access API).
   */
  statFile(path: string): Promise<FileStat>;

  /**
   * Watch a folder for changes, invoking `cb` on each change.
   * @returns an unsubscribe function.
   * Web has no general recursive-watch primitive — `WebAdapter` throws here
   * until 0.6.0. Electron wiring lands with the in-app editor (#38).
   */
  watchFolder(path: string, cb: () => void): () => void;

  /**
   * Read a secret by key (e.g. a GitHub token). Lands with #12.
   * Electron: OS keychain via `safeStorage`. Web: encrypted localStorage.
   */
  getSecret(key: string): Promise<string | null>;

  /** Store a secret by key. Lands with #12. */
  setSecret(key: string, value: string): Promise<void>;
}
