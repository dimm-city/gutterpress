/**
 * Platform abstraction contract (GitHub #41).
 *
 * The viewer talks to its host through ONE seam so that the app code never
 * branches on `electron` vs `web` directly. Today the only host is Electron
 * (IPC + native dialogs). When the PWA lands (0.6.0, #...), a `WebAdapter`
 * backed by the File System Access API drops in behind the same interface and
 * the app code does not change.
 *
 * This module is **types only** — it is imported by the browser SPA via
 * `import type`, so it must never pull in a Node runtime dependency.
 *
 * Canonical home: `@dimm-city/print-md-lib`. The viewer re-exports these types
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
   * Editor seam for #38/#39 — no current consumer in 0.4.0.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * List the immediate entries of a directory (single level, no recursion).
   * @returns each entry's `name`, absolute `path`, and whether it `isDir`.
   * Editor seam for #38 (file-tree sidebar). Electron: `node:fs/promises`
   * `readdir`. Web: File System Access API (0.6.0).
   */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>;

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
