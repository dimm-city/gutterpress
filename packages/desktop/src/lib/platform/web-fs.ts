/**
 * web-fs — File System Access (FSA) primitives for the PWA WebAdapter (#33).
 *
 * §8 / ADR 0004: this is RENDERER/BROWSER code. It uses ONLY browser APIs —
 * NO `node:*`, NO `fs`/`path`/`url`, NO value import from `gutterpress`.
 * All "path math" is pure string manipulation (split on "/"), never `node:path`.
 *
 * ── The handle registry + key model (plan §4) ────────────────────────────────
 * FSA handles have no path strings and are not `===`-comparable across calls, so
 * the adapter keys everything on an app-minted opaque id. `registerHandle()`
 * stashes a root `FileSystemDirectoryHandle` in an in-memory `Map` and returns
 * that id; `FolderRef.key` carries it.
 *
 * ── How a Platform path string maps to a handle ──────────────────────────────
 * The Platform contract's `readFile(path)`/`writeFile(path,…)`/`listDir(path)`/
 * `statFile(path)` take a single string. On the web that string is
 * `"<rootKey>/<relpath>"`, where `<rootKey>` (e.g. `web:ab12…`) is a single
 * slash-free segment that identifies the open root in the registry, and the rest
 * is a project-root-relative POSIX path. `splitPath()` peels the root key off the
 * front; the remainder is walked with `getDirectoryHandle()`/`getFileHandle()`.
 * `listDir` returns each child's `path` as `"<rootKey>/<relpath>"` so the same
 * string round-trips straight back into `readFile`.
 *
 * This module is deliberately free of any DOM-iframe / preview / persistence
 * concern (those land in later phases) so it is unit-testable with a fake FSA
 * tree (see tests/platform/web-fs.test.ts).
 */

/** Returned by {@link statFileFromRoot}; mirrors the lib's `FileStat`. */
export interface WebFileStat {
  size: number;
  mtimeMs: number;
  exists: boolean;
}

/** Returned by {@link writeFileToRoot}; mirrors the lib's `FileWriteResult`. */
export interface WebFileWriteResult {
  mtimeMs: number;
  size: number;
}

/** One listing row; mirrors the `PlatformAdapter.listDir` element shape. */
export interface WebDirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

// ── Handle registry (§4) ─────────────────────────────────────────────────────

const KEY_PREFIX = "web:";
const registry = new Map<string, FileSystemHandle>();

/** Mint a stable, slash-free, app-generated opaque id (never path-derived). */
function mintKey(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return KEY_PREFIX + uuid;
}

/** Register a handle and return its opaque registry key. */
export function registerHandle(handle: FileSystemHandle): string {
  const key = mintKey();
  registry.set(key, handle);
  return key;
}

/**
 * Re-register a handle under an EXISTING key (vs {@link registerHandle}, which
 * mints a fresh key). Used when reopening a persisted project (#33 Phase 3): the
 * key was minted in a prior session and stored in IndexedDB alongside the
 * handle; on reload the handle is restored under that same key so every recents/
 * favorites/project-state row keeps resolving.
 */
export function reRegisterHandle(key: string, handle: FileSystemHandle): void {
  registry.set(key, handle);
}

/** Resolve a registry key back to its handle; throws if the key is unknown. */
export function resolveHandle(key: string): FileSystemHandle {
  const handle = registry.get(key);
  if (!handle) {
    throw new Error(
      `No File System Access handle registered for key "${key}". ` +
        `The folder must be (re)opened before its files can be accessed.`,
    );
  }
  return handle;
}

/** Clear the registry (test helper / future "close project"). */
export function resetRegistry(): void {
  registry.clear();
}

// ── Pure path helpers (no node:path) ─────────────────────────────────────────

/** Normalise a relpath: strip leading "./" and "/", collapse to clean segments. */
function relSegments(relPath: string): string[] {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s.length > 0 && s !== ".");
}

/**
 * Split a Platform path string into its `{ rootKey, segments }`. The first
 * slash-separated segment is the registry key (`web:…`); the rest is the
 * project-root-relative path.
 */
export function splitPath(path: string): { rootKey: string; segments: string[] } {
  const norm = path.replace(/\\/g, "/");
  const slash = norm.indexOf("/");
  if (slash < 0) return { rootKey: norm, segments: [] };
  return {
    rootKey: norm.slice(0, slash),
    segments: relSegments(norm.slice(slash + 1)),
  };
}

/** Build a Platform path string from a root key + relative segments. */
function joinPath(rootKey: string, segments: string[]): string {
  return segments.length === 0 ? rootKey : `${rootKey}/${segments.join("/")}`;
}

// ── FSA walking ──────────────────────────────────────────────────────────────

/**
 * Walk from `root` to the directory holding `segments[last]`, returning the
 * parent dir handle. With `create:true`, missing intermediate dirs are created.
 */
async function walkToParent(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i]!, { create });
  }
  return dir;
}

async function getDirHandle(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg);
  }
  return dir;
}

// ── Primitives (root-handle-relative; the adapter peels the key first) ────────

/** Read a file's text by walking `relPath` from `root`. */
export async function readFileFromRoot(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<string> {
  const segments = relSegments(relPath);
  const name = segments[segments.length - 1];
  if (!name) throw new Error(`readFile: empty path "${relPath}"`);
  const parent = await walkToParent(root, segments, false);
  const fileHandle = await parent.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.text();
}

/** Write `content` to `relPath` (creating the file/dirs), return the re-stat mtime. */
export async function writeFileToRoot(
  root: FileSystemDirectoryHandle,
  relPath: string,
  content: string,
): Promise<WebFileWriteResult> {
  const segments = relSegments(relPath);
  const name = segments[segments.length - 1];
  if (!name) throw new Error(`writeFile: empty path "${relPath}"`);
  const parent = await walkToParent(root, segments, true);
  const fileHandle = await parent.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  // Re-stat for the post-write mtime (FileWriteResult contract). Re-resolve from
  // the parent rather than reusing the pre-write handle, so implementations that
  // snapshot on open (notably OPFS) report the fresh mtime.
  const fresh = await parent.getFileHandle(name);
  const file = await fresh.getFile();
  return { mtimeMs: file.lastModified, size: file.size };
}

/** List the direct children of `relDir` (relative to `root`). */
export async function listDirFromRoot(
  root: FileSystemDirectoryHandle,
  relDir: string,
  // Required: each child `path` is stamped `"<rootKey>/<relpath>"` so it
  // round-trips straight back into readFile/writeFile/statFile. Emitting a bare
  // relpath would not resolve (the first segment must be a registry key).
  rootKey: string,
): Promise<WebDirEntry[]> {
  const segments = relSegments(relDir);
  const dir = await getDirHandle(root, segments);
  const out: WebDirEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    const childSegments = [...segments, name];
    out.push({
      name,
      path: joinPath(rootKey, childSegments),
      isDir: handle.kind === "directory",
    });
  }
  return out;
}

/** Stat a file; `exists:false` (with zeroed size/mtime) when it is absent. */
export async function statFileFromRoot(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<WebFileStat> {
  try {
    const segments = relSegments(relPath);
    const name = segments[segments.length - 1];
    if (!name) return { size: 0, mtimeMs: 0, exists: false };
    const parent = await walkToParent(root, segments, false);
    const fileHandle = await parent.getFileHandle(name);
    const file = await fileHandle.getFile();
    return { size: file.size, mtimeMs: file.lastModified, exists: true };
  } catch (err) {
    // "Not found" is the normal absent-file case → {exists:false}. Anything else
    // (permission revoked, corrupt handle, real I/O failure) must NOT masquerade
    // as "file gone" — re-throw so the caller can surface/log it.
    if (
      err instanceof DOMException &&
      (err.name === "NotFoundError" || err.name === "TypeMismatchError")
    ) {
      return { size: 0, mtimeMs: 0, exists: false };
    }
    throw err;
  }
}

/**
 * Shallow listing of the project root's `.md` / `.css` files, each sorted by
 * filename — the web equivalent of the Electron `listProjectFiles` IPC (#42).
 */
export async function listProjectFilesFromRoot(
  root: FileSystemDirectoryHandle,
): Promise<{ md: string[]; css: string[] }> {
  const md: string[] = [];
  const css: string[] = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== "file") continue;
    const lower = name.toLowerCase();
    if (lower.endsWith(".md")) md.push(name);
    else if (lower.endsWith(".css")) css.push(name);
  }
  md.sort((a, b) => a.localeCompare(b));
  css.sort((a, b) => a.localeCompare(b));
  return { md, css };
}

// ── FSA feature detection ────────────────────────────────────────────────────

/**
 * True when the File System Access directory picker is available (Chrome/Edge).
 * Safari has no `showDirectoryPicker`, so the WebAdapter degrades capabilities
 * (Phase 6 OPFS/import-export fallback is out of scope for Phase 1).
 */
export function hasFsa(): boolean {
  return (
    typeof globalThis.window !== "undefined" &&
    typeof (globalThis.window as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      "function"
  );
}
