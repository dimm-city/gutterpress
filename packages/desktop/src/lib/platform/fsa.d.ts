/**
 * Minimal ambient declaration for the File System Access (FSA) directory picker
 * (#33). The DOM lib already ships `FileSystemDirectoryHandle`/
 * `FileSystemFileHandle`/`FileSystemWritableFileStream` and the async-iterable
 * `entries()`, but TypeScript's bundled `lib.dom.d.ts` does NOT yet declare
 * `window.showDirectoryPicker`. We add ONLY that one member here (narrow, no
 * external `@types/wicg-file-system-access` dependency).
 */
interface Window {
  /**
   * Show the OS directory picker (Chrome/Edge). Resolves with the chosen root
   * handle, or rejects with a DOMException whose `name` is "AbortError" when the
   * user cancels. Optional because it is absent on Chrome for Android and in
   * insecure/cross-origin-iframe contexts (the WebAdapter degrades there).
   */
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | string;
  }) => Promise<FileSystemDirectoryHandle>;
}

/**
 * `FileSystemDirectoryHandle.entries()` lives in TypeScript's
 * `lib.dom.asynciterable.d.ts`, which is NOT in this project's `lib` array
 * (`DOM` + `DOM.Iterable` only). Declare just the async-iterable `entries()` we
 * use here so we don't have to widen the global `lib` set.
 */
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
