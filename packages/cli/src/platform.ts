/**
 * Platform abstraction contract (GitHub #41).
 *
 * Filesystem/host primitive types shared between the lib and the desktop.
 * The desktop's renderer never touches these operations directly: they are
 * implemented host-side in the Electron main process and exposed to the SPA
 * as typed IPC (CLAUDE.md §8); the SPA sees only DTO types via `import type`.
 *
 * This module is **types only** — it is imported by the browser SPA via
 * `import type`, so it must never pull in a Node runtime dependency.
 *
 * Canonical home: `gutterpress`. The desktop re-exports these types from
 * `src/lib/platform/contract.ts`. (The former `Platform` service locator and
 * its `electron-adapter.ts`/`web-adapter.ts` implementations were deleted in
 * 0.11 — SFE-P5a/P5b; ADR 0014/0016.)
 */

/**
 * The narrow set of host capabilities that need native/OS access: native
 * dialogs, raw file IO, filesystem watching, and OS-keychain-backed secrets.
 * The desktop implements each operation in the Electron main process; the
 * wider host RPC surface lives in the desktop's own
 * `electron/server-bridge/host-services.ts`, not here.
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
  /** Which host backs this adapter. Electron is the only implementation left. */
  readonly platform: "electron";

  /**
   * Prompt the user to choose a project folder.
   * @returns the absolute path, or `null` if the user cancelled.
   * Electron: native directory dialog.
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
   * `readdir`.
   */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>;

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
   * Implemented host-side by the Electron main process (the folder-watch
   * wiring in `electron/main.ts` + `electron/api/fs-watch.ts`).
   */
  watchFolder(path: string, cb: () => void): () => void;

  /**
   * Read a secret by key (e.g. a GitHub token). Lands with #12.
   * Electron: OS keychain via `safeStorage`.
   */
  getSecret(key: string): Promise<string | null>;

  /** Store a secret by key. Lands with #12. */
  setSecret(key: string, value: string): Promise<void>;
}
